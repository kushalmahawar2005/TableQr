import type { PaidPreview } from "@/app/(guest)/r/[outlet]/t/[table]/paid/_components/paid-screen";
import type { AfterVisitData } from "@/server/guest/after-visit";

// Sample after-visit states for the G9 review board. Sample data only.

type Live = Extract<AfterVisitData, { expired: false }>;
export const g9Base: Live = {
  expired: false,
  renderedAt: Date.parse("2026-10-01T15:14:00Z"),
  outlet: { code: "SRJ01", name: "Spice Route", logoUrl: null, accentColor: "#C9482B" },
  table: { code: "T12" },
  state: "open",
  me: { name: "Aarav" },
  paidPaise: 54100,
  tipPaise: 0,
  mySettled: true,
  paidFor: [],
  progress: { paid: 3, total: 4 },
  waitingFor: ["Chirag"],
  allSettled: false,
  receipt: { available: true, kind: "payment_receipt" },
  channels: [],
  rating: null,
  reviewUrl: "https://g.page/r/spice-route/review",
  bookingUrl: null,
};

export type G9Case = { id: string; label: string; data: AfterVisitData; preview: PaidPreview; lang?: "en" | "hi"; width?: number; height?: number; loading?: boolean; solo?: boolean };

export function g9Cases(): G9Case[] {
  const b = g9Base;
  const closed: Live = { ...b, state: "closed", allSettled: true, progress: { paid: 4, total: 4 }, waitingFor: [], receipt: { available: true, kind: "tax_invoice" } };
  return [
    { id: "others-unpaid", label: "1 · Paid, others unpaid", data: b, preview: {} },
    { id: "all-paid", label: "2 · All paid (table closed)", data: closed, preview: {} },
    { id: "paid-for", label: "3 · Paid for someone else (with tip)", data: { ...b, paidPaise: 116100, tipPaise: 5800, paidFor: ["Chirag"], progress: { paid: 3, total: 4 }, waitingFor: ["Divya"] }, preview: {} },
    { id: "still-open", label: "4 · Table still open, two waiting", data: { ...b, progress: { paid: 2, total: 4 }, waitingFor: ["Chirag", null] }, preview: {} },
    { id: "closed", label: "5 · Final closed table", data: { ...closed, rating: 5 }, preview: {} },
    { id: "receipt", label: "6 · Receipt available (no GSTIN: Receipt)", data: { ...closed, receipt: { available: true, kind: "receipt" } }, preview: {} },
    { id: "channels", label: "7 · Receipt delivery configured", data: { ...closed, channels: ["whatsapp", "sms"] as ("whatsapp" | "sms")[] }, preview: { sent: "+9198xxxxxx10" } },
    { id: "low", label: "8 · Low rating submitted", data: { ...b, rating: 2 }, preview: { justRated: true } },
    { id: "high", label: "9 · High rating submitted", data: { ...b, rating: 5 }, preview: { justRated: true } },
    { id: "review", label: "10 · Review link available", data: b, preview: {} },
    { id: "no-review", label: "11 · No review link", data: { ...b, reviewUrl: null }, preview: {} },
    { id: "read-only", label: "12 · After-visit 24h read-only (with booking when built)", data: { ...closed, rating: 4, bookingUrl: "/r/SRJ01/book" }, preview: {} },
    { id: "expired", label: "13 · Expired after-visit access", data: { expired: true, outlet: b.outlet, table: b.table, renderedAt: b.renderedAt }, preview: {} },
    { id: "hindi", label: "14 · Hindi", lang: "hi", data: { ...b, me: { name: "आरव" } }, preview: {} },
    { id: "not-paid", label: "Not paid yet", data: { ...b, paidPaise: 0, mySettled: false, receipt: { available: false, kind: "payment_receipt" }, waitingFor: ["Chirag", "Aarav"] }, preview: {} },
    { id: "offline", label: "Offline", data: b, preview: { offline: true } },
    { id: "w320", label: "16 · 320 × 640", data: closed, preview: {}, width: 320, height: 640 },
    { id: "w390", label: "17 · 390 × 844", data: b, preview: {}, width: 390, height: 844 },
    { id: "loading", label: "Loading", data: b, preview: {}, loading: true },
  ];
}
