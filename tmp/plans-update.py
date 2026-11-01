from pathlib import Path
p=Path('src/lib/plan-features.ts');s=p.read_text();s=s.replace('  "attendance",','  "attendance",\n  "riderTracking",',1).replace('  dineIn: { label:','  riderTracking: { label: "Rider assignment & tracking", hint: "Assign delivery riders and track deliveries" },\n  dineIn: { label:',1);s=s.replace('k !== "inventory" &&','k !== "riderTracking" && k !== "inventory" &&');a=s.index('const LITE =');b=s.index('/** A hotel without',a);s=s[:a]+'''const LITE = { ...NONE, dineIn: true, pos: true, kitchenDisplay: true, inventory: true, delivery: true, multiOutlet: true, discounts: true, guestPwaCustomization: true };
const PLUS = { ...LITE, waiterApp: true, fullReports: true, whatsappBills: true, attendance: true };
const PRO = { ...PLUS, reservations: true, riderTracking: true, pricingRules: true, groupSplit: true };

'''+s[b:];s=s.replace('name: "Lite", monthlyPricePaise: 99900','name: "Base", monthlyPricePaise: 69900').replace('name: "Plus", monthlyPricePaise: 249900','name: "Growth", monthlyPricePaise: 129900').replace('name: "Pro", monthlyPricePaise: 499900','name: "Advanced", monthlyPricePaise: 220000');# no arbitrary limits agreed
for old in ['maxTables: 6, maxStaff: 3','maxTables: 12, maxStaff: 6','maxTables: 20, maxStaff: 20'] : s=s.replace(old,'maxTables: null, maxStaff: null')
p.write_text(s)
p=Path('src/server/plan.ts');s=p.read_text();s='import type { BusinessType, CommercialSettings } from "@/lib/subscription-pricing";\n'+s;s=s.replace('tableLimit: number | null }): Features','tableLimit: number | null; businessType?: BusinessType | null; commercial?: CommercialSettings | null; outletId?: string }): Features');s=s.replace('  return f;','''  if (row.businessType) {
    f.dineIn = row.businessType === "restaurant" || row.businessType === "cafe" || row.businessType === "hotel_restaurant";
    f.rooms = row.businessType === "hotel" || row.businessType === "hotel_restaurant";
    if (row.businessType === "hotel") f.delivery = false;
    if (!f.dineIn) f.reservations = false;
  }
  for (const key of ["waiterApp", "reservations", "riderTracking"] as const) {
    const enabled = row.commercial?.addons[key] ?? [];
    if (enabled.length && (!row.outletId || enabled.includes(row.outletId))) f[key] = true;
  }
  if (row.businessType && !f.dineIn) f.reservations = false;
  return f;''',1);s=s.replace('tenantFeatures(tenantId: string)', 'tenantFeatures(tenantId: string, outletId?: string)');s=s.replace('features: s.plans.features, customFeatures:', 'businessType: s.tenants.businessType, commercial: s.tenants.commercial, features: s.plans.features, customFeatures:');s=s.replace('effectiveFeatures(row) :','effectiveFeatures({ ...row, outletId }) :');p.write_text(s)
