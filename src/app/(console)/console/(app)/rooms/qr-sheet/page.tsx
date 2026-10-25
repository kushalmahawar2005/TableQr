import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { publicBaseUrl } from "@/server/floor/qr-read";
import { qrSvg } from "@/server/floor/qr-svg";
import { currentStaff } from "@/server/staff/request";
import { QR_SIZES, qrPages, qrSheetCss, qrSize, type QrSize } from "../../floor/_components/qr-print";
import { PrintBar } from "../../floor/editor/qr-sheet/print-bar";

// Every room's QR as a printable card, several per A4 sheet, to keep in the room. ?size=a6|a5|a4
export default async function RoomQrSheetPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "rooms")) return <main className="p-8">Permission denied</main>;
  const q = await props.searchParams;
  const size = (QR_SIZES.find((x) => x.id === q.size)?.id ?? "a6") as QrSize;
  const { qrMm: mm, scale } = qrSize(size);
  const base = await publicBaseUrl(staff);
  const rows = await db
    .select({ id: s.rooms.id, number: s.rooms.number, shortCode: s.qrCodes.shortCode })
    .from(s.rooms)
    .innerJoin(s.qrCodes, and(eq(s.qrCodes.tenantId, s.rooms.tenantId), eq(s.qrCodes.tableId, s.rooms.tableId), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt)))
    .where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.outletId, staff.outletId), eq(s.rooms.isActive, true)));
  const rooms = rows.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  return (
    <main className="min-h-dvh bg-neutral-100 text-neutral-900">
      <style>{qrSheetCss(size)}</style>
      <PrintBar count={rooms.length} size={size} outlet={staff.outlet.name} back={{ href: "/console/rooms", label: "← Back to rooms" }} noun={["room", "rooms"]} />
      {rooms.length === 0 ? (
        <p className="no-print mx-auto max-w-md p-10 text-center text-neutral-600">No rooms yet. Add your rooms first, then come back to print.</p>
      ) : (
        <div className="qr-sheet mx-auto grid max-w-5xl gap-6 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {qrPages(rooms, size).map((page, i) => <div key={i} className="qr-page contents">{page.map((r) => (
            <section key={r.id} className="poster flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-6 text-center shadow-sm" style={{ minHeight: `${mm * 1.9}px` }}>
              <h1 className="text-xl font-extrabold" style={{ fontSize: `${1.25 * scale}rem` }}>{staff.outlet.name}</h1>
              <p className="text-sm text-neutral-600" style={{ fontSize: `${0.8 * scale}rem` }}>Scan to order food to your room, or ask for towels, cleaning and more</p>
              <div style={{ width: `${mm}mm`, maxWidth: "100%", aspectRatio: "1" }} className="[&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg(`${base}/r/${staff.outlet.code}/room/${r.shortCode}`) }} />
              <p className="font-extrabold" style={{ fontSize: `${1.8 * scale}rem` }}>Room {r.number}</p>
              <p className="text-xs text-neutral-400">Powered by TableQR</p>
            </section>
          ))}</div>)}
        </div>
      )}
    </main>
  );
}
