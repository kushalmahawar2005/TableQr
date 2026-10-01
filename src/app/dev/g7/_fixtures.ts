import type { TablePreview } from "@/app/(guest)/r/[outlet]/t/[table]/table/_components/table-screen";
import type { TableScreenData } from "@/server/guest/table-screen";

// Sample tables for the G7 review board and its tests. Sample data only, never business logic.

export const NOW = Date.parse("2026-10-01T15:14:00Z");
type Person = TableScreenData["people"][number];
type Request = TableScreenData["requests"][number];

const person = (id: string, name: string | null, extra: Partial<Person> = {}): Person => ({ id, name, isMe: false, isHost: false, state: "active", ...extra });
const idle = (kind: Request["kind"]): Request => ({ kind, requestId: null, requestedAt: null, cooldownUntil: 0, status: null, escalated: false });
const kinds = ["water", "cutlery", "call_waiter", "clean_table", "request_bill"] as const;

export const g7Base: TableScreenData = {
  renderedAt: NOW,
  outlet: { code: "SRJ01", name: "Spice Route", city: "Jaipur", logoUrl: null, accentColor: "#C9482B" },
  table: { code: "T12" },
  invite: { mode: "open", joinCode: null },
  session: { key: "dev-g7", status: "open", orderingLocked: false, isHost: true, hostName: "Aarav", hostIsMe: true, people: 4 },
  people: [person("p-aarav", "Aarav", { isMe: true, isHost: true }), person("p-riya", "Riya"), person("p-karan", "Karan"), person("p-guest", null)],
  ordered: { totalPaise: 199_000, items: 9, rounds: 3, inKitchen: 7 },
  inProgress: 7,
  requests: kinds.map(idle),
};

const asGuest = (d: TableScreenData): TableScreenData => ({
  ...d,
  session: { ...d.session, isHost: false, hostIsMe: false },
  people: [person("p-aarav", "Aarav", { isHost: true }), person("p-riya", "Riya", { isMe: true }), ...d.people.slice(2)],
});

const withRequests = (d: TableScreenData, over: Partial<Record<Request["kind"], Partial<Request>>>): TableScreenData => ({
  ...d,
  requests: d.requests.map((r) => ({ ...r, ...over[r.kind] })),
});

export type G7Case = { id: string; label: string; data: TableScreenData; preview: TablePreview; lang?: "en" | "hi"; solo?: boolean; loading?: boolean; removedLanding?: boolean; width?: number; height?: number };

export function g7Cases(): G7Case[] {
  const base = g7Base;
  return [
    { id: "single-real", label: "1 · Single host, real name", data: { ...base, session: { ...base.session, people: 1 }, people: [base.people[0]], ordered: { totalPaise: 0, items: 0, rounds: 0, inKitchen: 0 }, inProgress: 0 }, preview: {} },
    { id: "single-placeholder", label: "2 · Single host, no name yet", data: { ...base, session: { ...base.session, people: 1, hostName: null }, people: [person("p-me", null, { isMe: true, isHost: true })], ordered: { totalPaise: 0, items: 0, rounds: 0, inKitchen: 0 }, inProgress: 0 }, preview: {} },
    { id: "multiple", label: "3 · Multiple people (host view)", data: base, preview: {} },
    { id: "non-host", label: "4 · Non-host view", data: asGuest(base), preview: {} },
    { id: "invite-open", label: "5 · Invite, Open mode", data: base, preview: { sheet: "invite" }, solo: true },
    { id: "invite-verified", label: "6 · Invite, Verified mode", data: { ...base, invite: { mode: "verified", joinCode: null } }, preview: { sheet: "invite" }, solo: true },
    { id: "invite-code", label: "7 · Invite, Host-confirmed mode", data: { ...base, invite: { mode: "host_confirmed", joinCode: "4729" } }, preview: { sheet: "invite" }, solo: true },
    { id: "ordering-open", label: "8 · Ordering open", data: base, preview: {} },
    { id: "paused", label: "9 · Ordering paused (host)", data: { ...base, session: { ...base.session, orderingLocked: true } }, preview: {} },
    { id: "paused-guest", label: "9b · Ordering paused (guest)", data: asGuest({ ...base, session: { ...base.session, orderingLocked: true } }), preview: {} },
    { id: "manage", label: "10 · Manage people", data: base, preview: { sheet: "manage" }, solo: true },
    { id: "person", label: "10b · Person menu (⋯)", data: base, preview: { sheet: "person", targetId: "p-riya" }, solo: true },
    { id: "remove", label: "11 · Remove confirmation", data: base, preview: { confirm: "remove", targetId: "p-karan" }, solo: true },
    { id: "pass", label: "12 · Pass-host confirmation", data: base, preview: { confirm: "pass", targetId: "p-riya" }, solo: true },
    { id: "removed", label: "13 · Removed participant (host view)", data: { ...base, session: { ...base.session, people: 3 }, people: base.people.filter((p) => p.id !== "p-karan") }, preview: { notice: { text: "Karan was removed from the table." } } },
    { id: "removed-phone", label: "13b · Removed person's phone (G1)", data: base, preview: {}, removedLanding: true },
    { id: "paid", label: "14 · Paid and left", data: { ...base, session: { ...base.session, people: 3 }, people: [...base.people.slice(0, 3), person("p-vivek", "Vivek", { state: "paid" })] }, preview: {} },
    { id: "service", label: "15 · Service requests, normal", data: base, preview: {} },
    {
      id: "cooldown",
      label: "16 · Service cooldown / notified / done",
      data: withRequests(base, {
        water: { requestId: "w", status: "open", requestedAt: NOW - 65_000, cooldownUntil: NOW + 55_000 },
        cutlery: { requestId: "c", status: "done", requestedAt: NOW - 25_000, cooldownUntil: NOW + 95_000 },
        clean_table: { requestId: "t", status: "done", requestedAt: NOW - 300_000, cooldownUntil: NOW - 180_000 },
      }),
      preview: {},
    },
    { id: "bill", label: "17 · Bill requested", data: withRequests({ ...base, session: { ...base.session, status: "bill_requested", orderingLocked: false } }, { request_bill: { requestId: "b", status: "open", requestedAt: NOW - 60_000, cooldownUntil: NOW + 60_000 } }), preview: {} },
    { id: "offline", label: "18 · Offline", data: base, preview: { offline: true } },
    { id: "loading", label: "19 · Loading", data: base, preview: {}, loading: true },
    {
      id: "hindi",
      label: "20 · Hindi",
      lang: "hi",
      data: { ...base, outlet: { ...base.outlet, name: "स्पाइस रूट" }, session: { ...base.session, hostName: "आरव" }, people: [person("p-aarav", "आरव", { isMe: true, isHost: true }), person("p-riya", "प्रिया"), person("p-karan", "Karan"), person("p-guest", null)] },
      preview: {},
    },
    {
      id: "long-names",
      label: "Long names (wrap check)",
      data: { ...base, session: { ...base.session, isHost: false, hostIsMe: false, hostName: "Venkataraghavan Subramaniam" }, people: [person("p-aarav", "Venkataraghavan Subramaniam", { isHost: true }), person("p-riya", "Anne-Marie D’Souza-Fernandes", { isMe: true }), person("p-k", "श्रीनिवास रामचंद्रन"), person("p-guest", null)] },
      preview: {},
    },
    { id: "w320", label: "22 · 320 × 640", data: base, preview: {}, width: 320, height: 640 },
    { id: "w390", label: "23 · 390 × 844", data: base, preview: {}, width: 390, height: 844 },
  ];
}
