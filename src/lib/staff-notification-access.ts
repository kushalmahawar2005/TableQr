import { SECTION_FEATURE, type Features } from "./plan-features";
import { canSee, consoleSectionRoles, type ConsoleSectionSlug, type RoleAccess, type StaffRole } from "./staff-permissions";

export type NotificationStaff = { roles: readonly StaffRole[]; access?: RoleAccess | null };

/** Use the same section and package permissions as the destination screen. */
export function canOpenNotification(staff: NotificationStaff, features: Features, href: string): boolean {
  const path = href.split(/[?#]/)[0];
  if (path === "/waiter") return features.waiterApp && staff.roles.some(role => role === "waiter" || role === "owner" || role === "manager");
  if (path === "/rider") return features.delivery && staff.roles.includes("rider");
  const section = path.match(/^\/console\/([^/]+)$/)?.[1];
  if (!section || !(section in consoleSectionRoles)) return false;
  const required = SECTION_FEATURE[section];
  return canSee(staff, section as ConsoleSectionSlug) && (!required || features[required])
    && (section !== "kitchen" || features.kitchenDisplay);
}

export function orderNotificationDestination(staff: NotificationStaff, features: Features): string | null {
  return ["/console/orders", "/console/kitchen", "/waiter"].find(href => canOpenNotification(staff, features, href)) ?? null;
}

export function serviceNotificationDestination(staff: NotificationStaff, features: Features): string | null {
  return ["/console/floor", "/waiter"].find(href => canOpenNotification(staff, features, href)) ?? null;
}
