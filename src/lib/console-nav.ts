import { canSee, type StaffRole } from "./staff-permissions";

// Staff and owner sidebar (UI spec 3.5). Items a role cannot use are hidden, not disabled;
// the roles for each live in staff-permissions.ts and are checked on the server.
export const consoleSections = [
  { slug: "dashboard", label: "Dashboard", hi: "डैशबोर्ड" },
  { slug: "floor", label: "Floor", hi: "फ़्लोर" },
  { slug: "reservations", label: "Reservations", hi: "बुकिंग" },
  { slug: "waitlist", label: "Waitlist", hi: "वेटलिस्ट", live: false },
  { slug: "orders", label: "Orders", hi: "ऑर्डर", live: false },
  { slug: "billing", label: "Billing", hi: "बिलिंग", live: false },
  { slug: "menu", label: "Menu", hi: "मेन्यू" },
  { slug: "pricing", label: "Pricing", hi: "प्राइसिंग" },
  { slug: "reports", label: "Reports", hi: "रिपोर्ट", live: false },
  { slug: "settings", label: "Settings", hi: "सेटिंग्स", live: false },
] as const;

/** Sections with a real screen. The rest stay reserved and are hidden until they are built. */
export const visibleSections = consoleSections.filter((s) => !("live" in s && s.live === false));

export type ConsoleSection = (typeof consoleSections)[number]["slug"];

export function isConsoleSection(slug: string): slug is ConsoleSection {
  return consoleSections.some((s) => s.slug === slug);
}

/** Where /console sends this person: the first section their roles may open, or null */
export function landingSection(roles: readonly StaffRole[]): ConsoleSection | null {
  return visibleSections.find((s) => canSee(roles, s.slug))?.slug ?? null;
}

/**
 * Where a person goes right after signing in: the dashboard for owners and managers, the waiter
 * app for waiters, the POS for cashiers and accountants, the kitchen display for kitchen staff, and
 * the floor for hosts. A person with several roles gets the first that applies, in that order.
 */
export function homeFor(roles: readonly StaffRole[]): string {
  if (landingSection(roles) === "dashboard") return "/console/dashboard";
  const has = (...r: StaffRole[]) => roles.some((x) => r.includes(x));
  if (has("host")) return "/console/floor";
  if (has("waiter")) return "/waiter";
  if (has("cashier", "accountant")) return "/pos";
  if (has("kitchen")) return "/kds";
  return "/console/floor";
}

/** True when the section has a real screen; the catch-all route 404s the others */
export const isLiveSection = (slug: string) => visibleSections.some((s) => s.slug === slug);
