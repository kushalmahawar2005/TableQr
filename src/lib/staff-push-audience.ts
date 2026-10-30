import type { Features } from "./plan-features";
import { canOpenNotification, orderNotificationDestination, type NotificationStaff } from "./staff-notification-access";

export type PushAudience = { sessionId: string; kind: "service" | "ready" | "order" } | { riderUserId: string } | { kind: "delivery" | "management" };

/** A notification must lead to a workspace this recipient can actually use. */
export function pushNotificationDestination(
  staff: NotificationStaff & { id: string; duty: string },
  features: Features,
  requestedUrl: string | undefined,
  audience: PushAudience | undefined,
  assignedWaiter: string | null,
): string | null {
  if (audience && "riderUserId" in audience) {
    return staff.id === audience.riderUserId && canOpenNotification(staff, features, "/rider") ? "/rider" : null;
  }
  const management = staff.roles.some(role => role === "owner" || role === "manager");
  const waiter = features.waiterApp && staff.roles.includes("waiter") && staff.duty === "on" && (!assignedWaiter || assignedWaiter === staff.id);
  const kind = audience && "kind" in audience ? audience.kind : undefined;
  if (kind === "service" || kind === "ready") {
    return features.waiterApp && (management || waiter) && canOpenNotification(staff, features, "/waiter") ? "/waiter" : null;
  }
  if (kind === "order" || kind === "delivery") {
    if (kind === "delivery" && !features.delivery) return null;
    const kitchen = staff.roles.includes("kitchen") && canOpenNotification(staff, features, "/console/kitchen");
    const orderDesk = (management || staff.roles.includes("cashier")) && canOpenNotification(staff, features, "/console/orders");
    if (orderDesk) return kind === "delivery" ? "/console/orders?view=delivery" : "/console/orders";
    if (kitchen) return "/console/kitchen";
    if (kind === "order" && waiter) return "/waiter";
    return null;
  }
  // Booking, waitlist and payment verification alerts follow their section permissions,
  // including custom restrictions and category/package switches.
  if (requestedUrl && canOpenNotification(staff, features, requestedUrl)) return requestedUrl;
  return kind === "management" ? null : orderNotificationDestination(staff, features);
}
