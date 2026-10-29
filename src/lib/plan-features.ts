// What a plan (or one restaurant's custom package) switches on. Shared by the admin screens, the
// console and the server checks, so a feature is named and described in one place only.

export const FEATURE_KEYS = [
  "dineIn",
  "rooms",
  "waiterApp",
  "discounts",
  "whatsappBills",
  "groupSplit",
  "reservations",
  "kitchenDisplay",
  "pricingRules",
  "fullReports",
  "multiOutlet",
  "inventory",
  "delivery",
  "guestPwaCustomization",
  "pos",
  "attendance",
  "riderTracking",
  "purchasing",
  "recipeCosting",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, { label: string; hint: string }> = {
  purchasing: { label: "Purchasing & wastage", hint: "Supplier bills, purchases and stock usage" },
  recipeCosting: { label: "Recipes & costing", hint: "Dish recipes, prep items and detailed stock cost controls" },
  riderTracking: { label: "Rider assignment & tracking", hint: "Assign delivery riders and track deliveries" },
  dineIn: { label: "Restaurant tables", hint: "Floor, table QR codes and dine-in. Off for a hotel without a restaurant" },
  rooms: { label: "Hotel rooms", hint: "Room QR for room service and housekeeping, check-in and check-out, and the Reception role" },
  waiterApp: { label: "Waiter app & shifts", hint: "Waiters get their own phone app, table alerts and shifts" },
  discounts: { label: "Bill discounts", hint: "Give a discount on the billing screen" },
  whatsappBills: { label: "WhatsApp bills & Customers", hint: "Send the bill on WhatsApp and keep a customers list" },
  groupSplit: { label: "Group bill split", hint: "Guests at one table split the bill between them" },
  reservations: { label: "Reservations & waitlist", hint: "Table bookings and the waiting list" },
  kitchenDisplay: { label: "Kitchen display (KDS)", hint: "Orders on a kitchen screen, and the Kitchen staff role" },
  pricingRules: { label: "Pricing rules", hint: "Outlet prices and bulk price changes" },
  fullReports: { label: "Full reports", hint: "Sales, items and staff reports (Day close is always included)" },
  multiOutlet: { label: "Multiple outlets", hint: "More than one outlet under this restaurant" },
  delivery: { label: "Delivery orders", hint: "Home delivery with outlet service areas, charges and payment preferences" },
  guestPwaCustomization: { label: "Branded guest app install", hint: "Let guests install this restaurant's booking and delivery experience with its name and logo" },
  pos: { label: "POS counter", hint: "Punch orders at the counter for a table or takeaway, including offline POS" },
  attendance: { label: "Staff attendance", hint: "Daily register: present, half day, absent, leave and week off" },
  inventory: { label: "Inventory & recipes", hint: "Stock that goes down as dishes sell, with low-stock alerts" },
};

/** Everything a restaurant gets: the switches above, the limits, and the guest page line */
export type Features = Record<FeatureKey, boolean> & {
  /** null means no limit */
  maxTables: number | null;
  maxStaff: number | null;
  maxRooms: number | null;
  /** Small "powered by Tableeqr" line on the guest page */
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
  const out = { maxTables: limit(r.maxTables), maxStaff: limit(r.maxStaff), maxRooms: limit(r.maxRooms), poweredBy: on(r.poweredBy, false) } as Features;
  // Older plan rows said "full" bookings for reservations plus waitlist
  const reservationsFallback = r.bookings === undefined ? true : r.bookings === "full";
  // Inventory, rooms and delivery came later: missing flags must not grant them.
  for (const k of FEATURE_KEYS) out[k] = on(r[k], k === "reservations" ? reservationsFallback : k !== "riderTracking" && k !== "inventory" && k !== "rooms" && k !== "delivery" && k !== "guestPwaCustomization");
  if (r.riderTracking == null) out.riderTracking = out.delivery;
  if (r.purchasing == null) out.purchasing = out.inventory;
  if (r.recipeCosting == null) out.recipeCosting = out.inventory;
  // Preserve prior eligibility for plans saved before this explicit feature existed.
  if (r.guestPwaCustomization === undefined || r.guestPwaCustomization === null) out.guestPwaCustomization = out.delivery || out.reservations;
  return out;
}

/** Console sections that need a feature; the rest come with every plan */
export const SECTION_FEATURE: Partial<Record<string, FeatureKey>> = {
  floor: "dineIn",
  rooms: "rooms",
  reservations: "reservations",
  waitlist: "reservations",
  pricing: "pricingRules",
  reports: "fullReports",
  customers: "whatsappBills",
  inventory: "inventory",
  pos: "pos",
  attendance: "attendance",
};

export const notInPlanMessage = (key: FeatureKey) =>
  `${FEATURE_LABELS[key].label} is not in your plan. Ask Tableeqr to upgrade your plan to use it.`;

const NONE: Record<FeatureKey, boolean> = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>;
/** A restaurant: tables, no rooms */
const LITE = { ...NONE, dineIn: true, pos: true, kitchenDisplay: true, inventory: true, delivery: true, multiOutlet: true, discounts: true, guestPwaCustomization: true };
const PLUS = { ...LITE, purchasing: true, waiterApp: true, fullReports: true, whatsappBills: true, attendance: true };
const PRO = { ...PLUS, recipeCosting: true, reservations: true, riderTracking: true, pricingRules: true, groupSplit: true };

/** A hotel without a restaurant floor: rooms, room service through the kitchen, and the bills */
export const HOTEL: Features = { ...NONE, rooms: true, pos: true, attendance: true, discounts: true, whatsappBills: true, kitchenDisplay: true, fullReports: true, maxTables: null, maxStaff: 10, maxRooms: 30, poweredBy: false };
/** A hotel with its own restaurant: everything in Pro, plus rooms */
export const HOTEL_PLUS: Features = { ...PRO, rooms: true, maxTables: 20, maxStaff: 25, maxRooms: 30, poweredBy: false };

/**
 * The plans a fresh database starts with. Names, prices and features are then the platform
 * admin's to change in Plans & Pricing; codes never change.
 */
export const DEFAULT_PLANS: { code: string; name: string; monthlyPricePaise: number | null; sortOrder: number; features: Features; isPublic?: boolean }[] = [
  { code: "starter", name: "Base", monthlyPricePaise: 69900, sortOrder: 0, features: { ...LITE, maxTables: null, maxStaff: null, maxRooms: null, poweredBy: true } },
  { code: "growth", name: "Growth", monthlyPricePaise: 129900, sortOrder: 1, features: { ...PLUS, maxTables: null, maxStaff: null, maxRooms: null, poweredBy: true } },
  { code: "pro", name: "Advanced", monthlyPricePaise: 220000, sortOrder: 2, features: { ...PRO, maxTables: null, maxStaff: null, maxRooms: null, poweredBy: false } },
  { code: "chain", isPublic: false, name: "Chain", monthlyPricePaise: null, sortOrder: 3, features: { ...PRO, multiOutlet: true, maxTables: null, maxStaff: null, maxRooms: null, poweredBy: false } },
  { code: "hotel", isPublic: false, name: "Hotel", monthlyPricePaise: 299900, sortOrder: 4, features: HOTEL },
  { code: "hotel_plus", isPublic: false, name: "Hotel + Restaurant", monthlyPricePaise: 699900, sortOrder: 5, features: HOTEL_PLUS },
  { code: "custom", name: "Custom", monthlyPricePaise: null, sortOrder: 99, features: { ...LITE, maxTables: 5, maxStaff: 2, maxRooms: null, poweredBy: true } },
];
