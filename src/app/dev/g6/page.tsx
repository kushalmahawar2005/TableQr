import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackerScreen, type TrackerPreview } from "@/app/(guest)/r/[outlet]/t/[table]/orders/_components/tracker-screen";
import OrdersLoading from "@/app/(guest)/r/[outlet]/t/[table]/orders/loading";
import { parseLang } from "@/lib/i18n";
import type { TrackerScreenData } from "@/server/guest/tracker-screen";
import { GUEST_STATUS_TEXT } from "@/domain/kitchen";

export const metadata: Metadata = { title: "G6 states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const NOW = Date.parse("2026-10-01T15:14:00Z");
type Round = TrackerScreenData["rounds"][number];
type Line = Round["lines"][number];
function line(id: string, nameEn: string, nameHi: string, status: Line["status"], qty = 1, mine = true): Line {
  return { id, nameEn, nameHi, qty, amountPaise: qty * 24000, status, options: [], note: null, isMine: mine, canCancel: mine && status === "placed" };
}
function round(n: number, status: Round["status"], lines: Line[], minutes = 3): Round {
  return { orderId: `r${n}`, roundNo: n, placedAt: NOW - minutes * 60_000, placedBy: n === 1 ? "Bhavna" : "Aarav", status, statusText: GUEST_STATUS_TEXT[status], step: status === "served" ? 3 : ["placed", "accepted", "preparing", "ready"].indexOf(status), isLate: false, lateAt: ["placed", "accepted", "preparing"].includes(status) ? NOW + 600_000 : null, lines };
}
const base: TrackerScreenData = {
  renderedAt: NOW,
  outlet: { code: "SRJ01", name: "Spice Route", logoUrl: null, accentColor: "#C9482B" },
  table: { code: "T12" }, timezone: "Asia/Kolkata",
  session: { key: "dev-g6", people: 4, status: "open", orderingLocked: false, isHost: true, hostName: "Aarav" },
  rounds: [
    round(2, "placed", [line("papad", "Masala Papad", "मसाला पापड़", "placed")]),
    round(1, "preparing", [line("paneer", "Paneer Tikka", "पनीर टिक्का", "ready"), { ...line("chicken", "Butter Chicken", "बटर चिकन", "preparing"), options: [{ nameEn: "Extra gravy", nameHi: "एक्स्ट्रा ग्रेवी", priceDeltaPaise: 3000 }], note: "Less spicy" }, line("naan", "Butter Naan", "बटर नान", "served", 3)], 22),
  ], inProgress: 3,
  requests: (["water", "cutlery", "call_waiter", "clean_table", "request_bill"] as const).map((kind) => ({ kind, requestId: null, requestedAt: null, cooldownUntil: 0, status: null, escalated: false })),
};

export default async function G6Preview(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const lang = parseLang(typeof q.lang === "string" ? q.lang : undefined);
  const cases: { id: string; label: string; data: TrackerScreenData; preview: TrackerPreview; loading?: boolean }[] = [
    { id: "normal", label: "Live rounds", data: base, preview: {} },
    { id: "items", label: "Item list tab", data: base, preview: { tab: "items" } },
    { id: "late", label: "Taking longer", data: { ...base, rounds: base.rounds.map((r, i) => i ? { ...r, isLate: true, lateAt: NOW - 60_000 } : r) }, preview: {} },
    { id: "empty", label: "Nothing ordered", data: { ...base, rounds: [], inProgress: 0 }, preview: {} },
    { id: "served", label: "All served", data: { ...base, rounds: [round(1, "served", [line("paneer", "Paneer Tikka", "पनीर टिक्का", "served", 2)])], inProgress: 0 }, preview: {} },
    { id: "mixed", label: "Mixed-state round", data: { ...base, rounds: [round(1, "preparing", [line("paneer", "Paneer Tikka", "पनीर टिक्का", "served", 1), line("chicken", "Butter Chicken", "बटर चिकन", "preparing", 1), line("naan", "Butter Naan", "बटर नान", "ready", 2), line("soda", "Fresh Lime Soda", "फ़्रेश लाइम सोडा", "cancelled", 1)], 18)], inProgress: 3 }, preview: {} },
    { id: "cancelled", label: "Cancelled and removed", data: { ...base, rounds: [round(1, "cancelled", [line("paneer", "Paneer Tikka", "पनीर टिक्का", "cancelled"), line("cola", "Cola", "कोला", "voided")])], inProgress: 0 }, preview: {} },
    { id: "offline", label: "Offline", data: base, preview: { offline: true } },
    { id: "failed", label: "Refresh failed", data: base, preview: { failed: true } },
    { id: "paused", label: "Ordering paused", data: { ...base, session: { ...base.session, orderingLocked: true } }, preview: {} },
    { id: "bill", label: "Bill requested", data: { ...base, session: { ...base.session, status: "bill_requested" } }, preview: {} },
    { id: "guest", label: "Non-host", data: { ...base, session: { ...base.session, isHost: false } }, preview: {} },
    { id: "requests", label: "Request pending / completed", data: { ...base, requests: base.requests.map((r, i) => i === 0 ? { ...r, requestId: "water", status: "open", requestedAt: NOW - 65_000, cooldownUntil: NOW + 55_000 } : i === 1 ? { ...r, requestId: "cutlery", status: "done", requestedAt: NOW - 25_000, cooldownUntil: NOW + 95_000 } : r) }, preview: {} },
    { id: "escalated", label: "Escalated request (> 5 min)", data: { ...base, requests: base.requests.map((r, i) => i === 0 ? { ...r, requestId: "water-esc", status: "open", escalated: true, requestedAt: NOW - 330_000, cooldownUntil: NOW - 210_000 } : r) }, preview: {} },
    { id: "confirm-cancel", label: "Cancel confirmation", data: base, preview: { confirm: "cancel" } },
    { id: "cancel-error", label: "Cancel race / already accepted", data: base, preview: { notice: { text: "Kitchen already confirmed this item.", error: true } } },
    { id: "confirm-bill", label: "Bill confirmation", data: base, preview: { confirm: "bill" } },
    { id: "loading", label: "Loading", data: base, preview: {}, loading: true },
  ];
  const solo = cases.find((s) => s.id === q.solo);
  if (solo) return <div data-big={q.text === "2" || undefined} className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 min-[360px]:px-5">{q.text === "2" && <style>{BIG_TEXT}</style>}{solo.loading ? <OrdersLoading /> : <TrackerScreen data={solo.data} lang={lang} shortCode="k7Qm" realtimeUrl={null} preview={solo.preview} />}{(q.solo === "requests" || q.solo === "escalated") && <script dangerouslySetInnerHTML={{ __html: `setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 100);` }} />}</div>;
  return <div className="min-h-dvh bg-[#ECE7DF] p-6"><header className="mb-6 flex flex-wrap items-center gap-4"><h1 className="font-display text-title font-bold">G6 · Orders</h1><a href="?lang=en" className="text-accent underline">English</a><a href="?lang=hi" className="text-accent underline">Hindi</a><p className="text-caption text-muted">Development review board. Sample orders only.</p></header><div className="flex flex-wrap items-start gap-6">{cases.filter((s) => !s.preview.confirm).map((s) => <figure key={s.id} className="w-[360px]"><figcaption className="mb-2 text-caption font-semibold text-muted"><a href={`?solo=${s.id}&lang=${lang}`}>{s.label}</a></figcaption><div className="relative h-[820px] overflow-auto rounded-[28px] border border-line bg-paper px-5 [transform:translateZ(0)]">{s.loading ? <OrdersLoading /> : <TrackerScreen data={s.data} lang={lang} shortCode="k7Qm" realtimeUrl={null} preview={s.preview} />}</div></figure>)}</div></div>;
}
const TYPE = { title: [22, 28], section: [16, 22], body: [14, 20], caption: [12, 16], label: [11, 14], button: [14, 20] };
const BIG_TEXT = Object.entries(TYPE).map(([k, [size, lh]]) => `[data-big] .text-${k}{font-size:${size * 2}px;line-height:calc(${lh * 2}px * var(--lh))}`).join("\n");
