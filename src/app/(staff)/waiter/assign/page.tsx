import { redirect } from "next/navigation";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentStaff, staffFor } from "@/server/staff/request";
import { assignWaiterToTable } from "@/server/staff/waiter";
import { revalidatePath } from "next/cache";
import Link from "next/link";
async function assign(form:FormData){"use server";const staff=await staffFor(["host","manager","owner"]);await assignWaiterToTable(staff,String(form.get("table")),String(form.get("waiter"))||null,String(form.get("period")));revalidatePath("/waiter/assign");}
export default async function AssignPage(){
 const staff=await currentStaff();if(!staff)redirect("/console/login");await staffFor(["host","manager","owner"]);
 const [tables,waiters,assignments]=await Promise.all([
 db.select({id:s.diningTables.id,code:s.diningTables.code}).from(s.diningTables).where(and(eq(s.diningTables.tenantId,staff.tenantId),eq(s.diningTables.outletId,staff.outletId))).orderBy(s.diningTables.code),
 db.select({id:s.users.id,name:s.users.name}).from(s.users).innerJoin(s.staffRoles,and(eq(s.staffRoles.tenantId,s.users.tenantId),eq(s.staffRoles.userId,s.users.id))).where(and(eq(s.users.tenantId,staff.tenantId),eq(s.users.isActive,true),eq(s.staffRoles.role,"waiter"),or(isNull(s.staffRoles.outletId),eq(s.staffRoles.outletId,staff.outletId)))),
 db.select().from(s.waiterTableAssignments).where(and(eq(s.waiterTableAssignments.tenantId,staff.tenantId),eq(s.waiterTableAssignments.outletId,staff.outletId),eq(s.waiterTableAssignments.active,true)))
 ]);
 return <main className="mx-auto min-h-dvh max-w-lg space-y-5 bg-paper p-4"><Link href="/console/floor" className="inline-flex min-h-11 items-center underline">← Host floor</Link><h1 className="text-2xl font-bold">Assign primary waiters</h1><p>One primary waiter per physical table. Assignments last up to 12 hours; reassign or release at shift handover. Combined parties use the main table’s waiter.</p>{tables.map(t=>{const a=assignments.find(a=>a.tableId===t.id&&a.expiresAt>new Date());return <form key={t.id} action={assign} className="space-y-3 rounded-xl border border-line p-4"><h2 className="text-xl font-bold">{t.code}</h2><input type="hidden" name="table" value={t.id}/><label className="block">Shift / session period<input required maxLength={40} name="period" defaultValue={a?.periodKey??new Date().toISOString().slice(0,10)} className="min-h-11 w-full rounded border p-2"/></label><label className="block">Primary waiter<select name="waiter" defaultValue={a?.waiterUserId??""} className="min-h-11 w-full rounded border p-2"><option value="">Unassigned / release</option>{[...new Map(waiters.map(w=>[w.id,w])).values()].map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><button className="min-h-11 w-full rounded bg-brand p-3 text-brand-on">Save assignment</button></form>;})}</main>;
}
