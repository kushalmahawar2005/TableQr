export const BUSINESS_TYPES = {
  cloud_kitchen: "Cloud Kitchen", cafe: "Café", restaurant: "Restaurant",
  hotel: "Hotel", hotel_restaurant: "Restaurant / Café + Hotel",
} as const;
export type BusinessType = keyof typeof BUSINESS_TYPES;
export const ADDONS = { waiterApp: { label: "Waiter App", paise: 29900 }, reservations: { label: "Reservations + party booking", paise: 29900 }, riderTracking: { label: "Rider assignment/tracking", paise: 39900 } } as const;
export type AddonKey = keyof typeof ADDONS;
export type CommercialSettings = {
  version: 1;
  outletCount: number;
  addons: Partial<Record<AddonKey, string[]>>;
  goLiveAt: string | null;
  setupReceivedPaise: number;
  setupReference: string;
};
export const EXTRA_OUTLET_PAISE = 40000;
export const setupFee = (outlets: number) => 499900 + Math.max(0, outlets - 1) * 150000;
export const DISCOUNTS: Record<number, number> = { 1: 0, 3: 8, 6: 12, 12: 18 };
export const STANDARD_PLANS = { starter: 69900, growth: 129900, pro: 220000 };
export function subscriptionQuote(basePaise: number, outlets: number, months: number, addonPaise = 0) {
  if (![1, 3, 6, 12].includes(months)) throw new Error("Choose 1, 3, 6 or 12 months.");
  if (!Number.isSafeInteger(basePaise) || basePaise < 0 || !Number.isInteger(outlets) || outlets < 1 || !Number.isSafeInteger(addonPaise) || addonPaise < 0) throw new Error("Invalid subscription price.");
  const monthlyPlanPaise = basePaise + (outlets - 1) * EXTRA_OUTLET_PAISE;
  const subtotalPaise = monthlyPlanPaise * months;
  const discountPercent = DISCOUNTS[months];
  const discountPaise = Math.round(subtotalPaise * discountPercent / 100);
  // Feature add-on discounts have not been agreed: their monthly rates stay unchanged.
  return { monthlyPlanPaise, subtotalPaise, discountPercent, discountPaise, addonPaise: addonPaise * months, totalPaise: subtotalPaise - discountPaise + addonPaise * months };
}
export function freeMonthEnd(value: Date) {
  const end = new Date(value); const day = end.getUTCDate();
  end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last)); return end;
}
