import { redirect } from "next/navigation";

// Delivery orders now sit in their own section of the Orders screen
export default function DeliveryOrdersPage() {
  redirect("/console/orders?view=delivery");
}
