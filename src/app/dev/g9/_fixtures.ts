import type { PaidPreview } from "@/app/(guest)/r/[outlet]/t/[table]/paid/_components/paid-screen";
import type { AfterVisitData } from "@/server/guest/after-visit";

// Sample after-visit states for the G9 review board. Sample data only.

type Live = Extract<AfterVisitData, { expired: false }>;
const NOW = Date.parse("2026-10-01T15:14:00Z");
const person = (name: string | null, paid: boolean, isMe = false) => ({ name, paid, isMe });

export const g9Base: Live = {
  expired: false,
  renderedAt: NOW,
  outlet: { code: "SRJ01", name: "Spice Route", logoUrl: null, accentColor: "#C9482B" },
  table: { code: "T12" },
  state: "open",
  closedAt: null,
  timezone: "Asia/Kolkata",
  me: { name: "Aarav" },
  paidPaise: 54100,
  tipPaise: 0,
  mySettled: true,
  paidFor: [],
  progress: { paid: 3, total: 4, people: [person("Aarav", true, true), person("Bhavna", true), person("Chirag", false), person("Divya", true)] },
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
  const everyone = { paid: 4, total: 4, people: b.progress.people.map((p) => ({ ...p, paid: true })) };
  // Closed a minute ago: "All settled"
  const closed: Live = { ...b, state: "closed", closedAt: NOW - 60_000, allSettled: true, progress: everyone, waitingFor: [], receipt: { available: true, kind: "tax_invoice" } };
  // Came back the next morning, inside 24 hours: the read-only summary
  const later: Live = { ...closed, closedAt: NOW - 14 * 3600_000, rating: 4 };
  return [
    { id: "others-unpaid", label: "1 · Paid, others still unpaid", data: b, preview: {} },
    {
      id: "paid-for",
      label: "2 · Paid for another person",
      data: { ...b, paidPaise: 116100, tipPaise: 0, paidFor: ["Chirag"], progress: { paid: 3, total: 4, people: [person("Aarav", true, true), person("Bhavna", false), person("Chirag", true), person("Divya", true)] }, waitingFor: ["Bhavna"] },
      preview: {},
    },
    { id: "all-paid", label: "3 · All settled (table closed)", data: closed, preview: {} },
    { id: "receipt", label: "4 · Receipt (no GSTIN: Receipt, not Tax invoice)", data: { ...closed, receipt: { available: true, kind: "receipt" } }, preview: {} },
    { id: "no-provider", label: "5 · No delivery provider (view only)", data: b, preview: {} },
    { id: "channels", label: "6 · Delivery provider configured (sent confirmed)", data: { ...closed, channels: ["whatsapp", "sms"] as ("whatsapp" | "sms")[] }, preview: { sent: "+9198xxxxxx10" } },
    { id: "rate", label: "7 · Rating untouched", data: b, preview: {} },
    { id: "rating-picked", label: "7b · Rating picked, feedback typed", data: b, preview: { picked: 4, comment: "Loved the biryani." } },
    { id: "high", label: "8 · Rating submitted", data: { ...b, rating: 5 }, preview: { justRated: true } },
    { id: "low", label: "9 · Low rating submitted (same review link)", data: { ...b, rating: 2 }, preview: { justRated: true } },
    { id: "review", label: "10 · Review link available", data: { ...closed, rating: 5 }, preview: {} },
    { id: "no-review", label: "11 · No review link", data: { ...b, reviewUrl: null }, preview: {} },
    { id: "read-only", label: "12 · 24h after-visit access (read-only)", data: later, preview: {} },
    { id: "expired", label: "13 · Expired after-visit access", data: { expired: true, outlet: b.outlet, table: b.table, renderedAt: b.renderedAt }, preview: {} },
    {
      id: "hindi",
      label: "14 · Hindi",
      lang: "hi",
      data: { ...b, me: { name: "आरव" }, paidPaise: 116100, paidFor: ["चिराग"], progress: { paid: 3, total: 4, people: [person("आरव", true, true), person("भावना", false), person("चिराग", true), person("दिव्या", true)] }, waitingFor: ["भावना"] },
      preview: {},
    },
    { id: "long-names", label: "Long names", data: { ...b, me: { name: "Aaravindakshan Venkataraman" }, paidFor: ["Chiragkumar Bhattacharya", "Divyalakshmi Ramaswamy"], waitingFor: ["Bhavnaben Parekh-Shah"] }, preview: {} },
    { id: "not-paid", label: "Not paid yet", data: { ...b, paidPaise: 0, mySettled: false, receipt: { available: false, kind: "payment_receipt" }, waitingFor: ["Chirag", "Aarav"] }, preview: {} },
    { id: "offline", label: "Offline", data: b, preview: { offline: true } },
    { id: "w320", label: "15 · 320 × 640", data: closed, preview: {}, width: 320, height: 640 },
    { id: "w390", label: "16 · 390 × 844", data: b, preview: {}, width: 390, height: 844 },
    { id: "loading", label: "Loading", data: b, preview: {}, loading: true },
  ];
}
