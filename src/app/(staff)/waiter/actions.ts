"use server";
import { staffFor } from "@/server/staff/request";
import { AppError } from "@/server/errors";
import { waiterBoard, waiterDetail, waiterMenu } from "@/server/staff/waiter-read";
import { claimWaiterVisit, requireOwnVisit, waiterRealtimeToken, waiterSeatTable } from "@/server/staff/waiter";
import { completeServiceRequest } from "@/server/guest/service-requests";
import { markServed } from "@/server/kitchen/actions";
import { addPhonelessDiner, staffPlaceOrder, waiterRequestBill, waiterReopenBill, changeWaiterLine, type Approval } from "@/server/staff/waiter-mutations";
import { settleAtCounter } from "@/server/billing/payments";
import { markReady } from "@/server/floor/table-actions";
import { requireFeature } from "@/server/plan";
import { myAttendance } from "@/server/attendance/register";
import { storeMenuImage } from "@/server/menu-storage";
import { db } from "@/db";
import * as sc from "@/db/schema";
import { and, eq } from "drizzle-orm";
const roles=["waiter","manager","owner"] as const;
/** Signed-in waiter, manager or owner of a restaurant whose plan has the waiter app */
async function waiterStaff(){const staff=await staffFor(roles);await requireFeature(staff.tenantId,"waiterApp",staff.outletId);return staff;}
async function run<T>(work:(staff:Awaited<ReturnType<typeof staffFor>>)=>Promise<T>) {
  try{return {ok:true as const,data:await work(await waiterStaff())};}
  catch(e){return {ok:false as const,error:e instanceof AppError?e.message:"Could not complete this action. Try again.",code:e instanceof AppError?e.code:"unknown"};}
}
export async function boardAction(){return run(waiterBoard);}
export async function detailAction(sessionId:string){return run(s=>waiterDetail(s,sessionId));}
export async function menuAction(){return run(waiterMenu);}
export async function tokenAction(){return waiterRealtimeToken(await waiterStaff());}
export async function doneAction(id:string){return run(s=>completeServiceRequest(s,id));}
export async function servedAction(ids:string[]){return run(s=>markServed(s,ids));}
export async function addDinerAction(sessionId:string,name:string){return run(async s=>{await requireOwnVisit(s,sessionId);return addPhonelessDiner(s,sessionId,name);});}
export async function orderAction(input:Parameters<typeof staffPlaceOrder>[1]){return run(async s=>{await requireOwnVisit(s,input.sessionId);return staffPlaceOrder(s,input);});}
export async function billAction(sessionId:string){return run(async s=>{await requireOwnVisit(s,sessionId);return waiterRequestBill(s,sessionId);});}
export async function reopenAction(sessionId:string,approval?:Approval){return run(async s=>{await requireOwnVisit(s,sessionId);return waiterReopenBill(s,sessionId,approval);});}
export async function lineAction(input:Parameters<typeof changeWaiterLine>[1]){return run(async s=>{await requireOwnVisit(s,input.sessionId);return changeWaiterLine(s,input);});}
export async function settleAction(input:{sessionId:string;forParticipantIds?:string[];method:"cash"|"card";receivedPaise?:number;clientRequestId:string;externalReference?:string}){return run(async s=>{await requireOwnVisit(s,input.sessionId);if(typeof input.clientRequestId !== "string" || !input.clientRequestId)throw new AppError("invalid_state","A settlement request id is required.");return settleAtCounter(s,input);});}
export async function cleanAction(id:string){return run(s=>markReady(s,id));}

export async function claimTableAction(sessionId: string) { return run(s => claimWaiterVisit(s, String(sessionId))); }
export async function seatAction(tableId: string, partySize: number) { return run(s => waiterSeatTable(s, String(tableId), Number(partySize))); }

/** The Me tab: own photo and own attendance (today and a month) */
export async function meAction(month?: string) {
  return run(async s => {
    const [me] = await db.select({ photoUrl: sc.users.photoUrl }).from(sc.users).where(and(eq(sc.users.tenantId, s.tenantId), eq(sc.users.id, s.userId!)));
    return { photoUrl: me?.photoUrl ?? null, attendance: await myAttendance(s, { month }) };
  });
}
export async function savePhotoAction(form: FormData) {
  return run(async s => {
    const file = form.get("photo");
    if (!(file instanceof File) || !file.size) throw new AppError("invalid_state", "Choose a photo.");
    if (!file.type.startsWith("image/") || file.size > 3_000_000) throw new AppError("invalid_state", "Use a photo under 3 MB.");
    const { url } = await storeMenuImage({ tenantId: s.tenantId, brandId: "staff", bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type, filename: file.name });
    await db.update(sc.users).set({ photoUrl: url }).where(and(eq(sc.users.tenantId, s.tenantId), eq(sc.users.id, s.userId!)));
    return { photoUrl: url };
  });
}
