import type { ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { BillingScreen } from "@/app/pos/_components/billing-screen";
import { consoleSections } from "@/lib/console-nav";

export const metadata: Metadata = { title: "Billing (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = ComponentProps<typeof BillingScreen>;
const card = (over: Record<string, unknown>) => ({ itemCount: 3, guestName: null, status: "bill_requested", billStatus: "open", totalPaise: 47_000, paidPaise: 0, balancePaise: 47_000, partySize: 2, requestedAt: Date.now() - 14 * 60_000, pendingOnline: false, payAtCounter: false, paidUpi: false, takeaway: false, ...over });

const initial = {
  identity: { name: "Owner", roles: ["owner"], outlet: "Spice Route" },
  queue: [
    card({ sessionId: "s1", tableCode: "T4", payAtCounter: true }),
    card({ sessionId: "s2", tableCode: "TA-6", takeaway: true, guestName: "Meera", totalPaise: 44_000, balancePaise: 44_000, paidUpi: true }),
    card({ sessionId: "s3", tableCode: "DL-q9Mi1ti_x", guestName: "Kushal Mahawar", totalPaise: 12_000, balancePaise: 12_000, pendingOnline: true }),
    card({ sessionId: "s4", tableCode: "T9", status: "open", requestedAt: null, totalPaise: 28_000, paidPaise: 8_000, balancePaise: 20_000 }),
    card({ sessionId: "s5", tableCode: "TA-7", takeaway: true, status: "open", requestedAt: null, totalPaise: 0, balancePaise: 0, itemCount: 0 }),
    card({ sessionId: "s7", tableCode: "TA-8", takeaway: true, status: "open", requestedAt: null, totalPaise: 0, balancePaise: 0, itemCount: 0 }),
    card({ sessionId: "s8", tableCode: "TA-9", takeaway: true, status: "open", requestedAt: null, totalPaise: 0, balancePaise: 0, itemCount: 2, guestName: "Rahul" }),
  ],
  recent: [card({ sessionId: "s6", tableCode: "T2", status: "closed", billStatus: "paid", balancePaise: 0, paidPaise: 47_000, requestedAt: null })],
  realtimeToken: null,
} as unknown as Props["initial"];

const preview = {
  sessionId: "s1", tableCode: "T4", takeaway: false, guestName: null, status: "bill_requested", needsApproval: false, discounts: true, pdfOnWhatsApp: false,
  people: [{ id: "p1", name: "Rohan", phone: null }, { id: "p2", name: "Anjali", phone: null }],
  bill: { status: "open", subtotalPaise: 44_762, discountPaise: 0, discount: null, taxPaise: 2_238, deliveryFeePaise: 0, serviceChargePaise: 0, roundOffPaise: 0, totalPaise: 47_000, shareToken: "demo", createdAt: new Date() },
  lines: [
    { id: "l1", qty: 1, name: "Fruit Bowl · Small", nameHi: null, unitPricePaise: 7_000, status: "served", participantId: "p1", note: null, personalForPickup: false },
    { id: "l2", qty: 4, name: "Fruit Bowl · Large", nameHi: null, unitPricePaise: 9_941, status: "served", participantId: "p2", note: null, personalForPickup: false },
  ],
  shares: [{ id: "a", participantId: "p1", amountPaise: 20_000, paidPaise: 0 }, { id: "b", participantId: "p2", amountPaise: 27_000, paidPaise: 0 }],
  payments: [],
} as unknown as NonNullable<Props["preview"]>;

const takeawayBill = { ...preview, tableCode: "TA-3", takeaway: true, status: "open", people: [], lines: [], shares: [], bill: null } as NonNullable<Props["preview"]>;
const runningBill = { ...takeawayBill, people: preview.people, lines: preview.lines, bill: { ...preview.bill, totalPaise: 0, subtotalPaise: 0, taxPaise: 0 } } as NonNullable<Props["preview"]>;
const paidBill = { ...preview, bill: { ...preview.bill, status: "paid" }, status: "closed", shares: [], payments: [{ id: "x", method: "cash", channel: "counter", amountPaise: 47_000, tipPaise: 0, status: "success", refund: { refundedPaise: 0, pendingPaise: 0, refundablePaise: 47_000, refunds: [] } }] } as unknown as NonNullable<Props["preview"]>;

// Development-only review board for Billing, with sample data and no server calls
export default async function BillingBoard(props: { searchParams: Promise<{ list?: string; takeaway?: string; running?: string; paid?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { list, takeaway, running, paid } = await props.searchParams;
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  return (
    <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug="billing" preview>
      <BillingScreen embedded initial={initial} realtimeUrl={null} preview={list ? null : takeaway ? takeawayBill : running ? runningBill : paid ? paidBill : preview} />
    </StaffShell>
  );
}
