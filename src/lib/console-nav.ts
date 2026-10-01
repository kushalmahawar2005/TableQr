// Staff and owner sidebar (UI spec 3.5). Items a role cannot use are hidden,
// not disabled; role filtering is added once auth exists.
export const consoleSections = [
  { slug: "floor", label: "Floor" },
  { slug: "reservations", label: "Reservations" },
  { slug: "waitlist", label: "Waitlist" },
  { slug: "orders", label: "Orders" },
  { slug: "billing", label: "Billing" },
  { slug: "menu", label: "Menu" },
  { slug: "pricing", label: "Pricing" },
  { slug: "reports", label: "Reports" },
  { slug: "settings", label: "Settings" },
] as const;

export type ConsoleSection = (typeof consoleSections)[number]["slug"];

export function isConsoleSection(slug: string): slug is ConsoleSection {
  return consoleSections.some((s) => s.slug === slug);
}
