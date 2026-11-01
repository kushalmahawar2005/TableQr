import type { ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { PosTerminalScreen } from "@/app/(console)/console/(app)/pos/_components/pos-terminal-screen";
import { PayPreview } from "./pay-preview";
import { consoleSections } from "@/lib/console-nav";

export const metadata: Metadata = { title: "POS (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Terminal = ComponentProps<typeof PosTerminalScreen>["initial"];
type PosBill = ComponentProps<typeof PayPreview>["detail"];

const dish = (id: string, categoryId: string, name: string, rupees: number, isVeg = true) => ({
  id, categoryId, name, nameHi: null, isVeg, imageUrl: null, station: "Kitchen",
  pricing: { pricePaise: rupees * 100, isAvailable: id !== "m6", groups: [] },
}) as unknown as Terminal["menu"][number];

const table = (id: string, code: string, seats: number, visit: Partial<NonNullable<Terminal["tables"][number]["visit"]>> | null = null) => ({
  id, code, seats, zoneId: "z1", state: visit ? "occupied" : "free",
  visit: visit && { id: `v-${id}`, status: "active", openedAt: Date.now() - 42 * 60_000, orderedPaise: 64_000, items: 3, guestName: null, ...visit },
}) as unknown as Terminal["tables"][number];

const initial = {
  loadedAt: Date.now(),
  tables: [table("t1", "T1", 2), table("t2", "T2", 4, {}), table("t3", "T3", 4), table("t4", "T4", 6, { status: "bill_requested" }), table("t5", "T5", 2), table("t6", "T6", 4)],
  zones: [{ id: "z1", name: "Ground floor" }],
  takeaways: [],
  categories: [{ id: "c1", name: "Bowls", nameHi: null }, { id: "c2", name: "Starters", nameHi: null }, { id: "c3", name: "Main course", nameHi: null }, { id: "c4", name: "Drinks", nameHi: null }],
  menu: [dish("m1", "c1", "Fruit Bowl", 100), dish("m2", "c1", "Protein bowl", 110), dish("m3", "c2", "Paneer Tikka", 240), dish("m4", "c2", "Chicken Seekh Kebab", 290, false), dish("m5", "c3", "Butter Chicken", 360, false), dish("m6", "c3", "Dal Makhani", 220), dish("m7", "c3", "Veg Biryani", 260), dish("m8", "c4", "Masala Chai", 40), dish("m9", "c4", "Fresh Lime Soda", 80)],
  openItem: { stations: ["Kitchen"], gst: false, taxRateBp: 0 },
} as unknown as Terminal;

const bill = {
  sessionId: "s1", tableId: "t1", tableCode: "TA-7", takeaway: true, guestName: null, status: "bill_requested", seller: { name: "Spice Route" }, invoice: null,
  bill: { id: "b1", status: "open", createdAt: Date.now(), subtotalPaise: 40_000, discountPaise: 0, discount: null, taxPaise: 2_000, taxBreakup: null, serviceChargePaise: 0, deliveryFeePaise: 0, roundOffPaise: 0, totalPaise: 42_000, shareToken: "dev" },
  people: [], lines: [], shares: [{ id: "x", participantId: null, amountPaise: 42_000, paidPaise: 0 }], payments: [], needsApproval: false, discounts: true, pdfOnWhatsApp: false,
} as unknown as PosBill;

// Development-only review board for the POS with sample data. ?pay=1 and ?pay=done show the payment panel.
export default async function PosBoard(props: { searchParams: Promise<{ pay?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { pay } = await props.searchParams;
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  return (
    <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug="pos" preview>
      <div className="dashboard-theme min-h-dvh bg-dashboard-canvas">
        {pay ? <div className="p-4"><aside className="flex h-[calc(100dvh-6.5rem)] w-full max-w-[23rem] flex-col rounded-2xl border border-line bg-surface"><PayPreview detail={bill} hi={false} offline={false} initialDone={pay === "done" ? { change: 8_000 } : null} /></aside></div> : <PosTerminalScreen initial={initial} initialSavedAt={initial.loadedAt} initialIsServerFresh outletId="dev-outlet" staffUserId="dev-user" sessionExpiresAt={initial.loadedAt + 3_600_000} hi={false} realtimeUrl={null} />}
      </div>
    </StaffShell>
  );
}
