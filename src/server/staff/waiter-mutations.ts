import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { clearMenuCache } from "../guest/menu";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { lockSession, loadBillInputs, syncBill } from "../billing/bill";
import { announceBill, requestBillInTransaction, reopenBill } from "../billing/payments";
import { isOpenLine, placeOrderTx, releasePortions, type AnyDraftLine } from "../guest/order";
import type { PriceQuote } from "@/domain/pricing";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { requireStaffRole } from "./waiter";
import { verifyStaffPin, type StaffSession } from "./auth";
import { audit } from "./audit";
import { lockOrder, syncTickets, syncOrderStatus } from "../kitchen/order-state";
import type { StaffRole } from "@/lib/staff-permissions";
import { checkFirstName, isPlaceholderName } from "@/domain/guest-name";
import { sendOutletPush } from "./web-push";

export type Approval = { phone: string; pin: string };
export async function managerApproval(staff: StaffSession, approval?: Approval, allowedRoles: readonly StaffRole[] = ["waiter", "manager", "owner"]) {
  await requireStaffRole(staff, allowedRoles);
  if (staff.roles.some(r=>r === "manager" || r === "owner")) return staff.userId;
  if (!approval) throw new AppError("forbidden", "Manager PIN required.");
  const result = await verifyStaffPin({outletCode:staff.outlet.code,...approval});
  if (result.scope.tenantId !== staff.tenantId || result.scope.outletId !== staff.outletId || !result.roles.some(r=>r === "manager" || r === "owner")) throw new AppError("forbidden", "An active manager at this outlet must approve.");
  return result.user.id;
}
export async function addPhonelessDiner(staff: StaffSession, sessionId: string, name = "", now = new Date(), roles: readonly StaffRole[] = ["waiter", "manager", "owner"]) {
  await requireStaffRole(staff, roles);
  const checked = checkFirstName(String(name));
  if (!checked.ok) throw new AppError("invalid_state", "Enter the customer’s name before taking an order.");
  const result = await db.transaction(async tx=>{
    const session = await lockSession(tx,{...staff,sessionId});
    if (session.status !== "open") throw new AppError("table_settling", "Reopen the bill before adding a diner.");
    const displayName = checked.name;
    const id=uuidv7();
    await tx.insert(s.participants).values({id,tenantId:staff.tenantId,sessionId,displayName,deviceId:null,guestId:null,addedByUserId:staff.userId,joinedAt:now});
    await audit(tx,staff,{action:"waiter.diner_added",entity:"participant",entityId:id,after:{sessionId,displayName},now});
    return {id,name:displayName};
  },LOCK_THEN_READ);
  await publish(staff,[{topic:topics.session(sessionId),type:"participant.joined"},{topic:topics.floor,type:"visit.updated"}]);
  return result;
}
export async function staffPlaceOrder(staff: StaffSession, input: {sessionId:string; tableId:string; participantId:string; clientRequestId:string; lines:AnyDraftLine[]; quote?: PriceQuote},now=new Date(),roles:readonly StaffRole[]=["waiter","manager","owner"]) {
  await requireStaffRole(staff, roles);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(input.clientRequestId) || !Array.isArray(input.lines) || !input.lines.length || input.lines.length>100 || input.lines.some(l=>(isOpenLine(l) ? typeof l.open !== "object" : (typeof l.itemId !== "string" || !Array.isArray(l.modifierIds) || l.modifierIds.some(m=>typeof m !== "string"))) || !Number.isInteger(l.qty) || (l.personalForPickup !== undefined && typeof l.personalForPickup !== "boolean"))) throw new AppError("invalid_state","Invalid draft order.");
  const [person] = await db.select({ name: s.participants.displayName }).from(s.participants).where(and(eq(s.participants.tenantId, staff.tenantId), eq(s.participants.sessionId, input.sessionId), eq(s.participants.id, input.participantId)));
  if (!person || isPlaceholderName(person.name) || !checkFirstName(person.name).ok) throw new AppError("invalid_state", "Enter the customer’s name before placing this order.");
  const [outlet] = await db.select().from(s.outlets).where(and(eq(s.outlets.tenantId,staff.tenantId),eq(s.outlets.id,staff.outletId)));
  const result=await placeOrderTx({...staff,sessionId:input.sessionId,tableId:input.tableId,participantId:input.participantId,brandId:outlet.brandId,timezone:outlet.timezone},{requestId:input.clientRequestId,quote:input.quote},now,{userId:staff.userId,lines:input.lines});
  if (!result.replayed) await publish(staff,[{topic:topics.kitchen,type:"ticket.created",data:{orderId:result.orderId}},{topic:topics.session(input.sessionId),type:"order.status",data:{orderId:result.orderId}},{topic:topics.floor,type:"visit.updated"},...result.soldOutItemIds.map(itemId=>({topic:topics.menu,type:"item.availability",data:{itemId,available:false}}))]);
  if (!result.replayed) await sendOutletPush(staff, { title: "New table order", body: "A staff member sent a new order to the kitchen.", url: "/console", tag: `order-${result.orderId}` }, { sessionId: input.sessionId, kind: "order" });
  return result;
}
export async function waiterRequestBill(staff:StaffSession,sessionId:string,now=new Date(),roles:readonly StaffRole[]=["waiter","manager","owner"]) {
  await requireStaffRole(staff, roles);
  const scope={...staff,sessionId};
  const result=await db.transaction(async tx=>{const res=await requestBillInTransaction(tx,scope,now); await audit(tx,staff,{action:"waiter.request_bill",entity:"session",entityId:sessionId,now});return res;},LOCK_THEN_READ);
  announceBill(scope,{tableIds:result.tableIds,state:"bill_requested"});return result;
}
export async function waiterReopenBill(staff:StaffSession,sessionId:string,approval?:Approval) {
  const approverUserId=await managerApproval(staff,approval);
  await reopenBill({kind:"staff",ctx:staff,sessionId},new Date(),{initiator:staff,approverUserId});
}

/** Ownership changes and voids share the session lock used by all payment starts. */
export async function changeWaiterLine(staff:StaffSession,input:{sessionId:string;lineId:string;destinationId?:string;reason?:string;approval?:Approval},now=new Date(), allowedRoles: readonly StaffRole[] = ["waiter", "manager", "owner"]) {
  await requireStaffRole(staff, allowedRoles);
  const moving=!!input.destinationId;
  if(!moving && !input.reason?.trim()) throw new AppError("invalid_state","A reason is required for every void.");
  // Verify approval outside the transaction so failed attempts survive rollback.
  const approverUserId=input.approval ? await managerApproval(staff,input.approval,allowedRoles) : staff.roles.some(r=>r === "manager" || r === "owner") ? staff.userId : null;
  const scope={...staff,sessionId:input.sessionId};
  const result=await db.transaction(async tx=>{
    const session=await lockSession(tx,scope);
    if(session.status !== "open") throw new AppError("invalid_state",session.status === "closed" ? "Manager action required" : "Reopen the bill first.");
    const [candidate]=await tx.select().from(s.orderLines).where(and(eq(s.orderLines.tenantId,staff.tenantId),eq(s.orderLines.sessionId,input.sessionId),eq(s.orderLines.id,input.lineId)));
    if(!candidate) throw new AppError("not_found","Item not found at this table.");
    await lockOrder(tx,staff.tenantId,staff.outletId,candidate.orderId);
    const [line]=await tx.select().from(s.orderLines).where(and(eq(s.orderLines.tenantId,staff.tenantId),eq(s.orderLines.id,input.lineId))).for("update");
    if(!moving && line.status === "voided") return {orderId:line.orderId, itemId:null as string|null, portionsRestored:false};
    if(["cancelled","voided"].includes(line.status)) throw new AppError("invalid_state","This item is no longer active.");
    const inputs=await loadBillInputs(tx,scope);
    const owners=new Set([line.participantId,...(line.sharedWith??[]),input.destinationId]);
    const affected=inputs.shares.filter(sh=>inputs.bill?.splitMode !== "my_items" || owners.has(sh.participantId));
    if(affected.some(sh=>sh.frozenAt || sh.paidPaise>0) || inputs.people.some(p=>owners.has(p.id)&&p.paidOutAt)) throw new AppError("invalid_state",moving ? "A paid or frozen share cannot be moved." : "Manager action required");
    if(inputs.payments.some(p=>["initiated","pending"].includes(p.status)&&p.allocations.some(a=>affected.some(sh=>sh.id===a.shareId)))) throw new AppError("invalid_state","An online payment is still pending or being checked.");
    let itemId:string|null=null;
    let portionsRestored=false;
    if(moving) {
      if(!inputs.people.some(p=>p.id===input.destinationId&&!p.removedAt&&!p.paidOutAt)) throw new AppError("invalid_state","Choose an active diner at this table.");
      await tx.update(s.orderLines).set({participantId:input.destinationId!,sharedWith:null}).where(and(eq(s.orderLines.tenantId,staff.tenantId),eq(s.orderLines.id,line.id)));
    } else {
      if(line.status !== "placed"&&!approverUserId) throw new AppError("forbidden","Manager PIN required for an accepted item.");
      await tx.update(s.orderLines).set({status:"voided",voidedAt:now,voidedByUserId:staff.userId,voidReason:input.reason!.trim().slice(0,200)}).where(and(eq(s.orderLines.tenantId,staff.tenantId),eq(s.orderLines.id,line.id)));
      // Ordering reserves finite portions. Release that reservation exactly once when a line is
      // voided; the line lock and the early return above make repeated void requests harmless.
      itemId=line.itemId;
      portionsRestored=!!line.itemId&&await releasePortions(tx,scope,line.itemId,line.qty);
      await syncTickets(tx,staff.tenantId,line.orderId,now);await syncOrderStatus(tx,staff.tenantId,line.orderId,now);
    }
    await syncBill(tx,scope,now);
    await audit(tx,staff,{action:moving?"waiter.item_moved":"waiter.item_voided",entity:"order_line",entityId:line.id,before:{participantId:line.participantId,sharedWith:line.sharedWith,status:line.status},after:{participantId:input.destinationId??line.participantId,approverUserId},reason:input.reason,now});
    return {orderId:line.orderId,itemId,portionsRestored};
  },LOCK_THEN_READ);
  announceBill(scope,undefined,[{topic:topics.session(input.sessionId),type:"order.status"},...(!moving?[{topic:topics.kitchen,type:"ticket.updated",data:{orderId:result.orderId}}]:[])]);
  if(result.portionsRestored&&result.itemId) {
    clearMenuCache(staff.tenantId);
    await publish(staff,[{topic:topics.menu,type:"item.availability",data:{itemId:result.itemId}}]);
  }
}
