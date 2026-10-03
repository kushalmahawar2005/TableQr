import { redirect } from "next/navigation";
import { currentStaff } from "@/server/staff/request";
import { floorEditorRoles } from "@/server/floor/editor";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { qrSvg } from "@/server/floor/qr-svg";

export default async function QrSheetPage() {
  const staff = await currentStaff(); if (!staff) redirect("/console/login"); if (!staff.roles.some((r) => floorEditorRoles.includes(r as never))) return <main className="p-8">Permission denied</main>;
  const tables = await db.select({ id: s.diningTables.id, code: s.diningTables.code, joinCode: s.diningTables.joinCode, shortCode: s.qrCodes.shortCode, outlet: s.outlets.name }).from(s.diningTables).innerJoin(s.qrCodes, and(eq(s.qrCodes.tenantId, s.diningTables.tenantId), eq(s.qrCodes.tableId, s.diningTables.id), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt))).innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.diningTables.tenantId), eq(s.outlets.id, s.diningTables.outletId))).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.isActive, true)));
  return <main className="qr-sheet bg-white p-4"><style>{`@page{size:A6;margin:8mm}.qr-page{page-break-after:always;min-height:120mm;display:grid;place-items:center;text-align:center}.cut{border:1px dashed #999;padding:8mm}`}</style>{tables.map((t) => <section key={t.id} className="qr-page"><div className="cut"><h1 className="text-xl font-bold">{t.outlet}</h1><h2 className="text-2xl font-bold">Table {t.code}</h2><div dangerouslySetInnerHTML={{ __html: qrSvg(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/r/${staff.outlet.code}/t/${t.shortCode}`) }} /><p>Join code <strong>{t.joinCode}</strong></p></div></section>)}</main>;
}
