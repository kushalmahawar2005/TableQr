import type { ComponentProps } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { OrdersScreen } from "@/app/(console)/console/(app)/orders/_components/orders-screen";
import { DeliveryQueueScreen } from "@/app/(console)/console/(app)/orders/delivery/screen";
import { consoleSections } from "@/lib/console-nav";

export const metadata: Metadata = { title: "Orders (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Delivery = ComponentProps<typeof DeliveryQueueScreen>;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const counter: ComponentProps<typeof OrdersScreen>["orders"] = [
  { id: "o1", sessionId: "s1", roundNo: 2, note: null, placedAt: ago(231), acceptedAt: ago(230), readyAt: ago(200), servedAt: null, table: "TA-6", status: "ready", items: [{ name: "Fruit Bowl", qty: 4 }], totalPaise: 40_000, readyLineIds: ["l1"], takeaway: true, delivery: null },
  { id: "o2", sessionId: "s2", roundNo: 2, note: "Less sugar", placedAt: ago(215), acceptedAt: ago(214), readyAt: null, servedAt: null, table: "TA-4", status: "accepted", items: [{ name: "Protein bowl", qty: 1 }], totalPaise: 11_000, readyLineIds: [], takeaway: true, delivery: null },
  { id: "o3", sessionId: "s3", roundNo: 1, note: null, placedAt: ago(6), acceptedAt: ago(5), readyAt: null, servedAt: null, table: "T4", status: "preparing", items: [{ name: "Butter Chicken", qty: 1 }, { name: "Butter Naan", qty: 3 }], totalPaise: 62_000, readyLineIds: [], takeaway: false, delivery: null },
];

const row = (over: Partial<Delivery["rows"][number]> & { id: string }): Delivery["rows"][number] => ({
  status: "placed", serviceMode: "delivery", name: "Kushal", phone: "+916367828788", address: { line: "SP-40, Arya College Road", locality: "Ajmer", pincode: "305901", instructions: "", lat: 26.4499, lng: 74.6399 },
  placedAt: ago(12), totalPaise: 10_000, paid: "unpaid", kitchenStatus: "preparing", items: [{ name: "Fruit Bowl", qty: 1 }], sessionId: "s", courierName: null, courierPhone: null, courierUserId: null, deliveryPin: null, paymentIssue: null, riderRating: null, riderRatingNote: null,
  ...over,
} as Delivery["rows"][number]);

const riders: NonNullable<Delivery["riders"]> = [
  { id: "r1", name: "Kushal Mahawar", phone: "+916367828788", photoUrl: null, vehicleNo: null, availability: "busy", activeCount: 1, location: null, verified: true },
  { id: "r2", name: "Ravi", phone: "+916367828799", photoUrl: null, vehicleNo: "RJ01 AB 1234", availability: "free", activeCount: 0, location: { lat: 26.4525, lng: 74.6345, at: Date.now() }, verified: false },
];

const rows = [
  row({ id: "d1", name: "Kushal Mahawar" }),
  row({ id: "d2", name: "Dev Joshi", kitchenStatus: "ready", paid: "paid", placedAt: ago(24), courierName: "Ravi", courierPhone: "+916367828799", courierUserId: "r2" }),
  row({ id: "d3", name: "Kushal", placedAt: ago(2347), items: [{ name: "Protein bowl", qty: 1 }], totalPaise: 11_000 }),
  row({ id: "d4", name: "Meera", serviceMode: "pickup", kitchenStatus: "ready", paid: "paid", placedAt: ago(9) }),
];

// Development-only review board for the Orders screens, with sample data
export default async function OrdersBoard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await props.searchParams;
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  const tabs = <p className="mt-4 text-sm"><Link href="/dev/orders" className="underline">Counter</Link> · <Link href="/dev/orders?view=delivery" className="underline">Guest</Link></p>;
  return (
    <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug="orders" preview>
      <div className="dashboard-theme min-h-dvh bg-dashboard-canvas">
        {view === "delivery"
          ? <DeliveryQueueScreen rows={rows} riders={riders} pendingPayments={[]} canAssignCourier tabs={tabs} availableModes={{ pickup: true, delivery: true }} />
          : <OrdersScreen orders={counter} outlet="Spice Route" tabs={tabs} />}
      </div>
    </StaffShell>
  );
}
