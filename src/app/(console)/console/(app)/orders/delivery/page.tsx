import type { Metadata } from "next";
import { staffFor } from "@/server/staff/request";
import { deliveryQueue, deliveryStaffRoles, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { DeliveryQueueScreen } from "./screen";
export const metadata: Metadata = { title: "Delivery orders", robots: { index: false, follow: false } };
export default async function DeliveryOrdersPage() {
  const staff = await staffFor(deliveryStaffRoles);
  const rows = await deliveryQueue(staff);
  const pendingPayments = await pendingManualDeliveryPayments(staff);
  return <DeliveryQueueScreen canAssignCourier={staff.roles.some(role => role === "owner" || role === "manager")} rows={rows.map(row => ({ ...row, placedAt: row.placedAt?.toISOString() ?? null }))} pendingPayments={pendingPayments.map(row => ({ ...row, claimedAt: row.claimedAt?.toISOString() ?? null }))} />;
}
