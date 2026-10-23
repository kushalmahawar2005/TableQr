import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { floorEditorRoles } from "@/server/floor/editor";
import { publicBaseUrl } from "@/server/floor/qr-read";
import { qrSvg } from "@/server/floor/qr-svg";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { FeatureLocked } from "../../../_components/feature-locked";
import { PrintBar } from "./print-bar";

const SIZES = { a6: { mm: 70, scale: 1 }, a5: { mm: 100, scale: 1.15 }, a4: { mm: 150, scale: 1.5 } } as const;

// Every table's QR as a printable poster, one per page. ?size=a6|a5|a4, ?table=<id> for just one.
export default async function QrSheetPage(props: PageProps<"/console/floor/editor/qr-sheet">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!staff.roles.some((r) => floorEditorRoles.includes(r as never))) return <main className="p-8">Permission denied</main>;
  if (!(await tenantFeatures(staff.tenantId)).dineIn) return <FeatureLocked feature="dineIn" />;
  const q = await props.searchParams;
  const size = (typeof q.size === "string" && q.size in SIZES ? q.size : "a6") as keyof typeof SIZES;
  const only = typeof q.table === "string" ? q.table : null;
  const { mm, scale } = SIZES[size];
  const base = await publicBaseUrl();
  const rows = await db
    .select({ id: s.diningTables.id, code: s.diningTables.code, joinCode: s.diningTables.joinCode, shortCode: s.qrCodes.shortCode })
    .from(s.diningTables)
    .innerJoin(s.qrCodes, and(eq(s.qrCodes.tenantId, s.diningTables.tenantId), eq(s.qrCodes.tableId, s.diningTables.id), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt)))
    .where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.isActive, true)));
  const tables = rows.filter((t) => !only || t.id === only).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return (
    <main className="min-h-dvh bg-neutral-100 text-neutral-900">
      <style>{`@page{size:${size.toUpperCase()};margin:8mm}@media print{.no-print{display:none!important}body{background:#fff}.poster{break-after:page;break-inside:avoid;border:0!important;box-shadow:none!important;margin:0!important;min-height:0!important}.poster:last-child{break-after:auto}}`}</style>
      <PrintBar count={tables.length} size={size} outlet={staff.outlet.name} single={!!only} />
      {tables.length === 0 ? (
        <p className="no-print mx-auto max-w-md p-10 text-center text-neutral-600">No tables with a live QR yet. Publish your floor plan first, then come back to print.</p>
      ) : (
        <div className="mx-auto grid max-w-5xl gap-6 p-4 print:block print:max-w-none print:p-0 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => (
            <section key={t.id} className="poster flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-6 text-center shadow-sm" style={{ minHeight: `${mm * 1.9}px` }}>
              <h1 className="text-xl font-extrabold" style={{ fontSize: `${1.25 * scale}rem` }}>{staff.outlet.name}</h1>
              <p className="text-sm text-neutral-600" style={{ fontSize: `${0.8 * scale}rem` }}>Scan to see the menu, order and pay from your phone</p>
              <div style={{ width: `${mm}mm`, maxWidth: "100%", aspectRatio: "1" }} className="[&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg(`${base}/r/${staff.outlet.code}/t/${t.shortCode}`) }} />
              <p className="font-extrabold" style={{ fontSize: `${1.8 * scale}rem` }}>Table {t.code}</p>
              {t.joinCode && <p className="text-sm text-neutral-600" style={{ fontSize: `${0.8 * scale}rem` }}>Joining friends? Use code <b className="tracking-[0.2em] text-neutral-900">{t.joinCode}</b></p>}
              <p className="text-xs text-neutral-400">Powered by TableQR</p>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
