import type { Metadata } from "next";
import { staffFor } from "@/server/staff/request";
import { deliveryQueue, deliveryStaffRoles } from "@/server/delivery/staff";
import { DeliveryQueueScreen } from "./screen";
export const metadata: Metadata = { title: "Delivery orders", robots: { index: false, follow: false } };
export default async function DeliveryOrdersPage() {
  const staff = await staffFor(deliveryStaffRoles);
  const rows = await deliveryQueue(staff);
  return <DeliveryQueueScreen rows={rows.map(row => ({ ...row, placedAt: row.placedAt?.toISOString() ?? null }))} />;
}
