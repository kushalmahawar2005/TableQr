"use server";
import { staffFor } from "@/server/staff/request";
import { AppError } from "@/server/errors";
import { waiterBoard, waiterDetail, waiterMenu } from "@/server/staff/waiter-read";
import { waiterRealtimeToken } from "@/server/staff/waiter";
import { completeServiceRequest } from "@/server/guest/service-requests";
import { markServed } from "@/server/kitchen/actions";
import { addPhonelessDiner, staffPlaceOrder, waiterRequestBill, waiterReopenBill, changeWaiterLine, type Approval } from "@/server/staff/waiter-mutations";
import { settleAtCounter } from "@/server/billing/payments";
import { markReady } from "@/server/floor/table-actions";
import { requireFeature } from "@/server/plan";
const roles=["waiter","manager","owner"] as const;
/** Signed-in waiter, manager or owner of a restaurant whose plan has the waiter app */
async function waiterStaff(){const staff=await staffFor(roles);await requireFeature(staff.tenantId,"waiterApp");return staff;}
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
export async function addDinerAction(sessionId:string,name:string){return run(s=>addPhonelessDiner(s,sessionId,name));}
export async function orderAction(input:Parameters<typeof staffPlaceOrder>[1]){return run(s=>staffPlaceOrder(s,input));}
export async function billAction(sessionId:string){return run(s=>waiterRequestBill(s,sessionId));}
export async function reopenAction(sessionId:string,approval?:Approval){return run(s=>waiterReopenBill(s,sessionId,approval));}
export async function lineAction(input:Parameters<typeof changeWaiterLine>[1]){return run(s=>changeWaiterLine(s,input));}
export async function settleAction(input:{sessionId:string;forParticipantIds?:string[];method:"cash"|"card";receivedPaise?:number;clientRequestId:string;externalReference?:string}){return run(s=>{if(typeof input.clientRequestId !== "string" || !input.clientRequestId)throw new AppError("invalid_state","A settlement request id is required.");return settleAtCounter(s,input);});}
export async function cleanAction(id:string){return run(s=>markReady(s,id));}
