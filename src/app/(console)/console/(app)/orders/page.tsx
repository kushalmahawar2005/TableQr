import { tenantFeatures } from "@/server/plan";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { outletRiders } from "@/server/delivery/riders";
import { availableGuestOrderModes, deliveryQueue, deliveryStaffRoles, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { getRecentOrders } from "@/server/staff/orders-read";
import { readOptional } from "@/server/optional-read";
import { currentStaff } from "@/server/staff/request";
import { OrdersScreen } from "./_components/orders-screen";
import { DeliveryQueueScreen } from "./delivery/screen";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

function optionalOrdersRead<T>(name: string, read: Promise<T>, fallback: T, failed: string[]) {
  return readOptional(read, fallback, (error) => {
    failed.push(name);
    console.error("[orders] optional data read failed", {
      subsystem: name,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

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
  const failedReads: string[] = [];
  const [orders, deliveries, pendingPayments, riders, configuredModes] = await Promise.all([
    getRecentOrders(staff, new Date()),
    canManageGuestOrders ? optionalOrdersRead("delivery queue", deliveryQueue(staff), [], failedReads) : Promise.resolve([]),
    canManageGuestOrders ? optionalOrdersRead("pending delivery payments", pendingManualDeliveryPayments(staff), [], failedReads) : Promise.resolve([]),
    showDelivery ? optionalOrdersRead("rider locations", outletRiders(staff), [], failedReads) : Promise.resolve([]),
    canManageGuestOrders ? optionalOrdersRead("guest order settings", availableGuestOrderModes(staff), { pickup: false, delivery: false }, failedReads) : Promise.resolve({ pickup: false, delivery: false }),
  ]);
  // Keep old orders reachable if a service is paused or removed from the current package.
  const modes = {
    pickup: configuredModes.pickup || deliveries.some(row => row.serviceMode === "pickup") || pendingPayments.some(row => row.serviceMode === "pickup"),
    delivery: configuredModes.delivery || deliveries.some(row => row.serviceMode === "delivery") || pendingPayments.some(row => row.serviceMode === "delivery"),
  };
  const hasGuestOrderSection = canManageGuestOrders && (modes.pickup || modes.delivery || failedReads.length > 0);
  const showGuestOrders = showDelivery && hasGuestOrderSection;
  const loadWarning = failedReads.length ? (
    <p role="alert" className="mx-auto mt-4 w-full max-w-[1560px] px-4 text-body font-semibold text-danger sm:px-6 lg:px-8">
      Some guest order data could not load ({failedReads.join(", ")}). Refresh this page before processing guest orders. <a href={view === "delivery" ? "/console/orders?view=delivery" : "/console/orders"} className="underline underline-offset-2">Refresh</a>
    </p>
  ) : null;
  const tableLive = orders.filter(o => !o.delivery && o.status !== "served" && o.status !== "cancelled").length;
  const deliveryLive = deliveries.filter(d => d.status !== "delivered" && d.status !== "collected" && d.status !== "cancelled").length + pendingPayments.length;
  const totalLive = tableLive + deliveryLive;
  const mainOrdersLabel = features.dineIn ? "Table / counter orders" : features.rooms ? "Room orders" : features.pos ? "Counter orders" : "Orders";

  const tab = (href: string, label: string, n: number, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-forest ${on ? "border-forest text-forest" : "border-transparent text-muted hover:text-ink"}`}>
      {label}
      {n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-md bg-forest px-1.5 text-xs font-bold text-white tabular">{n}</span>}
    </Link>
  );
  const guestOrderLabel = modes.pickup && modes.delivery ? "Guest pickup & delivery" : modes.pickup ? "Guest pickup" : "Guest delivery";
  const theme = "dashboard-theme min-h-[calc(100dvh-4rem)] bg-dashboard-canvas sm:min-h-[calc(100dvh-4.5rem)]";
  const tabs = hasGuestOrderSection ? (
    <nav aria-label="Order type" className="mt-4 flex flex-wrap items-center gap-x-7 border-b border-line">
      {tab("/console/orders", mainOrdersLabel, tableLive, !showGuestOrders)}
      {tab("/console/orders?view=delivery", guestOrderLabel, deliveryLive, showGuestOrders)}
      {/* Both sections together, so nothing waiting in the other tab goes unseen */}
      {totalLive > 0 && <p className="ml-auto pb-1 text-sm font-semibold text-ink"><span className="font-display text-lg font-bold tabular text-forest">{totalLive}</span> active {totalLive === 1 ? "order" : "orders"}</p>}
    </nav>
  ) : null;

  if (showGuestOrders) {
    return <div className={theme}>{loadWarning}<DeliveryQueueScreen
      tabs={tabs}
      riders={riders}
      realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null}
      canAssignCourier={features.riderTracking && staff.roles.some(role => role === "owner" || role === "manager")}
      availableModes={modes}
      rows={deliveries.map(row => ({ ...row, address: row.address ?? { line: "", locality: "", pincode: "", instructions: "" }, placedAt: row.placedAt?.toISOString() ?? null }))}
      pendingPayments={pendingPayments.map(row => ({ ...row, claimedAt: row.claimedAt?.toISOString() ?? null }))}
    /></div>;
  }
  // Delivery orders have their own section, so the table queue leaves them out
  return <div className={theme}>{loadWarning}<OrdersScreen orders={hasGuestOrderSection ? orders.filter(o => !o.delivery) : orders} outlet={staff.outlet.name} tabs={tabs} /></div>;
}
