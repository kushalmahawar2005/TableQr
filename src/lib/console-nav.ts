import { canSee, type StaffRole } from "./staff-permissions";

// Staff and owner sidebar (UI spec 3.5). Items a role cannot use are hidden, not disabled;
// the roles for each live in staff-permissions.ts and are checked on the server.
export const consoleSections = [
  { slug: "dashboard", label: "Dashboard", hi: "डैशबोर्ड" },
  { slug: "floor", label: "Floor", hi: "फ़्लोर" },
  { slug: "reservations", label: "Reservations", hi: "बुकिंग" },
  { slug: "waitlist", label: "Waitlist", hi: "वेटलिस्ट" },
  { slug: "orders", label: "Orders", hi: "ऑर्डर" },
  { slug: "billing", label: "Billing", hi: "बिलिंग" },
  { slug: "menu", label: "Menu", hi: "मेन्यू" },
  { slug: "pricing", label: "Pricing", hi: "प्राइसिंग" },
  { slug: "reports", label: "Reports", hi: "रिपोर्ट" },
  { slug: "settings", label: "Settings", hi: "सेटिंग्स" },
] as const;

export type ConsoleSection = (typeof consoleSections)[number]["slug"];

export function isConsoleSection(slug: string): slug is ConsoleSection {
  return consoleSections.some((s) => s.slug === slug);
}

/** Where /console sends this person: the first section their roles may open, or null */
export function landingSection(roles: readonly StaffRole[]): ConsoleSection | null {
  return consoleSections.find((s) => canSee(roles, s.slug))?.slug ?? null;
}
