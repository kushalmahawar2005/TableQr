import { tenantFeatures } from "@/server/plan";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { outletRiders } from "@/server/delivery/riders";
import { availableGuestOrderModes, deliveryQueue, deliveryStaffRoles, pendingManualDeliveryPayments } from "@/server/delivery/staff";
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
      <main className="p-4 sm:p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to orders.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  const { view } = await props.searchParams;
  const features = await tenantFeatures(staff.tenantId, staff.outletId);
  const canManageGuestOrders = staff.roles.some(role => (deliveryStaffRoles as readonly string[]).includes(role));
  const showDelivery = canManageGuestOrders && view === "delivery";
  const [orders, deliveries, pendingPayments, riders, configuredModes] = await Promise.all([
    getRecentOrders(staff, new Date()),
    canManageGuestOrders ? deliveryQueue(staff) : Promise.resolve([]),
    canManageGuestOrders ? pendingManualDeliveryPayments(staff) : Promise.resolve([]),
    showDelivery ? outletRiders(staff) : Promise.resolve([]),
    canManageGuestOrders ? availableGuestOrderModes(staff) : Promise.resolve({ pickup: false, delivery: false }),
  ]);
  // Keep old orders reachable if a service is paused or removed from the current package.
  const modes = {
    pickup: configuredModes.pickup || deliveries.some(row => row.serviceMode === "pickup") || pendingPayments.some(row => row.serviceMode === "pickup"),
    delivery: configuredModes.delivery || deliveries.some(row => row.serviceMode === "delivery") || pendingPayments.some(row => row.serviceMode === "delivery"),
  };
  const hasGuestOrderSection = canManageGuestOrders && (modes.pickup || modes.delivery);
  const showGuestOrders = showDelivery && hasGuestOrderSection;
  const tableLive = orders.filter(o => !o.delivery && o.status !== "served" && o.status !== "cancelled").length;
  const deliveryLive = deliveries.filter(d => d.status !== "delivered" && d.status !== "collected" && d.status !== "cancelled").length + pendingPayments.length;
  const mainOrdersLabel = features.dineIn ? "Table / counter orders" : features.rooms ? "Room orders" : features.pos ? "Counter orders" : "Orders";

  const tab = (href: string, label: string, n: number, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-body font-semibold transition-colors ${on ? "border-brand bg-brand text-brand-on" : "border-line bg-surface text-ink hover:border-ink/40"}`}>
      {label}
      {n > 0 && <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-label font-bold tabular ${on ? "bg-white/25 text-brand-on" : "bg-brand text-brand-on"}`}>{n}</span>}
    </Link>
  );
  const guestOrderLabel = modes.pickup && modes.delivery ? "Guest pickup & delivery" : modes.pickup ? "Guest pickup" : "Guest delivery";
  const tabs = hasGuestOrderSection ? (
    <nav aria-label="Order type" className="mt-4 flex flex-wrap gap-2">
      {tab("/console/orders", mainOrdersLabel, tableLive, !showGuestOrders)}
      {tab("/console/orders?view=delivery", guestOrderLabel, deliveryLive, showGuestOrders)}
    </nav>
  ) : null;

  if (showGuestOrders) {
    return <DeliveryQueueScreen
      outlet={staff.outlet.name}
      tabs={tabs}
      riders={riders}
      realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null}
      canAssignCourier={features.riderTracking && staff.roles.some(role => role === "owner" || role === "manager")}
      availableModes={modes}
      rows={deliveries.map(row => ({ ...row, address: row.address ?? { line: "", locality: "", pincode: "", instructions: "" }, placedAt: row.placedAt?.toISOString() ?? null }))}
      pendingPayments={pendingPayments.map(row => ({ ...row, claimedAt: row.claimedAt?.toISOString() ?? null }))}
    />;
  }
  // Delivery orders have their own section, so the table queue leaves them out
  return <OrdersScreen orders={hasGuestOrderSection ? orders.filter(o => !o.delivery) : orders} outlet={staff.outlet.name} tabs={tabs} />;
}
