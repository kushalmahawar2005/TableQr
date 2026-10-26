import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { outletRiders } from "@/server/delivery/riders";
import { deliveryQueue, deliveryStaffRoles, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { getRecentOrders } from "@/server/staff/orders-read";
import { currentStaff } from "@/server/staff/request";
import { OrdersScreen } from "./_components/orders-screen";
import { DeliveryQueueScreen } from "./delivery/screen";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

// One Orders screen with two sections: orders from tables and the counter, and home delivery
export default async function OrdersPage(props: PageProps<"/console/orders">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "orders")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to orders.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  const { view } = await props.searchParams;
  const runsDelivery = staff.roles.some(role => (deliveryStaffRoles as readonly string[]).includes(role));
  const showDelivery = runsDelivery && view === "delivery";
  const [orders, deliveries, pendingPayments, riders] = await Promise.all([
    getRecentOrders(staff, new Date()),
    runsDelivery ? deliveryQueue(staff) : Promise.resolve([]),
    runsDelivery ? pendingManualDeliveryPayments(staff) : Promise.resolve([]),
    showDelivery ? outletRiders(staff) : Promise.resolve([]),
  ]);
  const tableLive = orders.filter(o => !o.delivery && o.status !== "served" && o.status !== "cancelled").length;
  const deliveryLive = deliveries.filter(d => d.status !== "delivered").length + pendingPayments.length;

  const tab = (href: string, label: string, n: number, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-body font-semibold transition-colors ${on ? "border-brand bg-brand text-brand-on" : "border-line bg-surface text-ink hover:border-ink/40"}`}>
      {label}
      {n > 0 && <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-label font-bold tabular ${on ? "bg-white/25 text-brand-on" : "bg-brand text-brand-on"}`}>{n}</span>}
    </Link>
  );
  const tabs = runsDelivery ? (
    <nav aria-label="Order type" className="mt-4 flex flex-wrap gap-2">
      {tab("/console/orders", "Table orders", tableLive, !showDelivery)}
      {tab("/console/orders?view=delivery", "Delivery orders", deliveryLive, showDelivery)}
    </nav>
  ) : null;

  if (showDelivery) {
    return <DeliveryQueueScreen
      outlet={staff.outlet.name}
      tabs={tabs}
      riders={riders}
      canAssignCourier={staff.roles.some(role => role === "owner" || role === "manager")}
      rows={deliveries.map(row => ({ ...row, placedAt: row.placedAt?.toISOString() ?? null }))}
      pendingPayments={pendingPayments.map(row => ({ ...row, claimedAt: row.claimedAt?.toISOString() ?? null }))}
    />;
  }
  // Delivery orders have their own section, so the table queue leaves them out
  return <OrdersScreen orders={runsDelivery ? orders.filter(o => !o.delivery) : orders} outlet={staff.outlet.name} tabs={tabs} />;
}
