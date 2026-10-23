import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getRecentOrders } from "@/server/staff/orders-read";
import { currentStaff } from "@/server/staff/request";
import { OrdersScreen } from "./_components/orders-screen";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

export default async function OrdersPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "orders")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to orders.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  const orders = await getRecentOrders(staff, new Date());
  return <>{staff.roles.some(role => ["owner", "manager", "cashier"].includes(role)) && <div className="px-6 pt-4"><Link href="/console/orders/delivery" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold text-brand-strong">Delivery orders →</Link></div>}<OrdersScreen orders={orders} outlet={staff.outlet.name} /></>;
}
