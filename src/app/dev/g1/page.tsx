import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingSkeleton } from "@/app/(guest)/r/[outlet]/t/[table]/_components/landing-skeleton";
import { LandingNotFound, LandingView } from "@/app/(guest)/r/[outlet]/t/[table]/_components/landing-view";
import { parseLang } from "@/lib/i18n";
import type { TableLanding } from "@/server/guest/table";

export const metadata: Metadata = { title: "G1 states (dev)", robots: { index: false, follow: false } };

// Development-only review board: every G1 state side by side with sample data. Never in production.

const base: TableLanding = {
  outlet: {
    code: "SRJ01",
    name: "Spice Route",
    city: "Jaipur",
    logoUrl: null,
    accentColor: "#E4572E",
    sessionMode: "open",
    isOpen: true,
    closesAt: "23:30",
    nextOpen: null,
    poweredBy: false,
  },
  table: { code: "T12", maxSeats: 4, zone: "Indoor", state: "available" },
  landing: { kind: "start" },
};

const states: { id: string; label: string; data: TableLanding }[] = [
  { id: "start", label: "1 · Available → Start ordering", data: base },
  {
    id: "join",
    label: "2 · Session open → Join",
    data: { ...base, table: { ...base.table, state: "seated" }, landing: { kind: "join", count: 3, names: null, hostName: null } },
  },
  {
    id: "join-named",
    label: "2b · Join, after guests gave their names",
    data: {
      ...base,
      table: { ...base.table, state: "seated" },
      landing: { kind: "join", count: 3, names: ["Aarav", "Bhavna", "Chirag"], hostName: "Aarav" },
    },
  },
  {
    id: "verified",
    label: "Verified mode → button goes to G2",
    data: { ...base, outlet: { ...base.outlet, sessionMode: "verified" } },
  },
  {
    id: "reserved",
    label: "5 · Reserved",
    data: { ...base, table: { ...base.table, state: "reserved" }, landing: { kind: "reserved" } },
  },
  {
    id: "settling",
    label: "8 · Settling (new person)",
    data: { ...base, table: { ...base.table, state: "bill_requested" }, landing: { kind: "settling", isParticipant: false } },
  },
  {
    id: "settling-mine",
    label: "7 · Settling (already at table)",
    data: { ...base, table: { ...base.table, state: "bill_requested" }, landing: { kind: "settling", isParticipant: true } },
  },
  {
    id: "preparing",
    label: "9 · Paid / needs cleaning",
    data: { ...base, table: { ...base.table, state: "needs_cleaning" }, landing: { kind: "preparing" } },
  },
  {
    id: "blocked",
    label: "10 · Blocked",
    data: { ...base, table: { ...base.table, state: "blocked" }, landing: { kind: "blocked" } },
  },
  {
    id: "closed",
    label: "11 · Outlet closed",
    data: {
      ...base,
      outlet: { ...base.outlet, isOpen: false, closesAt: null, nextOpen: { day: "mon", time: "12:00", inDays: 2 } },
      landing: { kind: "closed" },
    },
  },
  {
    id: "awaiting",
    label: "Host-confirmed · not opened",
    data: { ...base, outlet: { ...base.outlet, sessionMode: "host_confirmed" }, landing: { kind: "awaiting_staff" } },
  },
  {
    id: "code",
    label: "Host-confirmed · code needed",
    data: {
      ...base,
      outlet: { ...base.outlet, sessionMode: "host_confirmed" },
      table: { ...base.table, state: "seated" },
      landing: { kind: "code_required" },
    },
  },
  { id: "revoked", label: "12 · Revoked QR", data: { ...base, landing: { kind: "revoked" } } },
  { id: "unavailable", label: "14 · Restaurant suspended", data: { ...base, landing: { kind: "unavailable" } } },
  {
    id: "brand",
    label: "Other brand · starter plan · green accent",
    data: {
      ...base,
      outlet: { ...base.outlet, name: "Cafe Nukkad", accentColor: "#39FF14", poweredBy: true, closesAt: null },
      table: { code: "B3", maxSeats: 2, zone: "Bar", state: "available" },
    },
  },
];

export default async function G1Preview(props: PageProps<"/dev/g1">) {
  if (process.env.NODE_ENV === "production") notFound();
  const lang = parseLang((await props.searchParams).lang as string | undefined);

  return (
    <div className="min-h-dvh bg-[#ECE7DF] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-title font-bold">G1 Landing: all states</h1>
        <a className="text-body font-semibold text-accent underline" href="?lang=en">English</a>
        <a className="text-body font-semibold text-accent underline" href="?lang=hi">Hindi</a>
        <p className="text-caption text-muted">Development only. Buttons do nothing here.</p>
      </header>
      <div className="flex flex-wrap items-start gap-6">
        {states.map((s) => (
          <Frame key={s.id} label={s.label}>
            <LandingView data={s.data} lang={lang} shortCode="k7Qm" preview />
          </Frame>
        ))}
        <Frame label="13 · Unknown QR">
          <LandingNotFound lang={lang} preview />
        </Frame>
        <Frame label="15 · Loading / slow network">
          <LandingSkeleton lang={lang} />
        </Frame>
      </div>
    </div>
  );
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="w-[360px]">
      <figcaption className="mb-2 text-caption font-semibold text-muted">{label}</figcaption>
      <div className="h-[720px] overflow-auto rounded-[28px] border border-line bg-paper px-5 shadow-[var(--shadow-float)] [&_.min-h-dvh]:min-h-full [&>div]:min-h-full">
        {children}
      </div>
    </figure>
  );
}
