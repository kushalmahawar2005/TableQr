// What a plan (or one restaurant's custom package) switches on. Shared by the admin screens, the
// console and the server checks, so a feature is named and described in one place only.

export const FEATURE_KEYS = [
  "waiterApp",
  "discounts",
  "whatsappBills",
  "groupSplit",
  "reservations",
  "kitchenDisplay",
  "pricingRules",
  "fullReports",
  "multiOutlet",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, { label: string; hint: string }> = {
  waiterApp: { label: "Waiter app & shifts", hint: "Waiters get their own phone app, table alerts and shifts" },
  discounts: { label: "Bill discounts", hint: "Give a discount on the billing screen" },
  whatsappBills: { label: "WhatsApp bills & Customers", hint: "Send the bill on WhatsApp and keep a customers list" },
  groupSplit: { label: "Group bill split", hint: "Guests at one table split the bill between them" },
  reservations: { label: "Reservations & waitlist", hint: "Table bookings and the waiting list" },
  kitchenDisplay: { label: "Kitchen display (KDS)", hint: "Orders on a kitchen screen, and the Kitchen staff role" },
  pricingRules: { label: "Pricing rules", hint: "Outlet prices and bulk price changes" },
  fullReports: { label: "Full reports", hint: "Sales, items and staff reports (Day close is always included)" },
  multiOutlet: { label: "Multiple outlets", hint: "More than one outlet under this restaurant" },
};

/** Everything a restaurant gets: the switches above, the two limits, and the guest page line */
export type Features = Record<FeatureKey, boolean> & {
  /** null means no limit */
  maxTables: number | null;
  maxStaff: number | null;
  /** Small "powered by TableQR" line on the guest page */
  poweredBy: boolean;
};

/**
 * Reads a stored features object. Plans saved before a switch existed get it switched on, so
 * nothing a restaurant already had disappears by surprise. Some databases hand JSON booleans back
 * as 0/1 or "false", so every form of "off" counts.
 */
export function readFeatures(raw: unknown): Features {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const on = (v: unknown, fallback: boolean) => (v === undefined || v === null ? fallback : !(v === false || v === 0 || v === "false" || v === "0"));
  const limit = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.max(1, Math.floor(Number(v))) || null);
  const out = { maxTables: limit(r.maxTables), maxStaff: limit(r.maxStaff), poweredBy: on(r.poweredBy, false) } as Features;
  // Older plan rows said "full" bookings for reservations plus waitlist
  const reservationsFallback = r.bookings === undefined ? true : r.bookings === "full";
  for (const k of FEATURE_KEYS) out[k] = on(r[k], k === "reservations" ? reservationsFallback : true);
  return out;
}

/** Console sections that need a feature; the rest come with every plan */
export const SECTION_FEATURE: Partial<Record<string, FeatureKey>> = {
  reservations: "reservations",
  waitlist: "reservations",
  pricing: "pricingRules",
  reports: "fullReports",
  customers: "whatsappBills",
};

export const notInPlanMessage = (key: FeatureKey) =>
  `${FEATURE_LABELS[key].label} is not in your plan. Ask TableQR to upgrade your plan to use it.`;
