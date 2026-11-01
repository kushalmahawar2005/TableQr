from pathlib import Path
p=Path('src/server/fees.ts');s=p.read_text();s='import { ADDONS, EXTRA_OUTLET_PAISE, subscriptionQuote } from "@/lib/subscription-pricing";\n'+s;s=s.replace('customPricePaise: s.tenants.customPricePaise, planPricePaise:', 'commercial: s.tenants.commercial, customPricePaise: s.tenants.customPricePaise, planPricePaise:',1);s=s.replace('  const earlier = latest &&','  const earlier = !t.commercial && latest &&',1);s=s.replace('const perOutletPaise = t.customPricePaise ?? earlier ?? t.planPricePaise ?? 0;','const perOutletPaise = t.customPricePaise ?? (earlier || null) ?? t.planPricePaise ?? 0;');s=s.replace('  const outletCount = Math.max(1, Number(outlets?.n ?? 1));\n  return { perOutletPaise, outletCount, totalPaise: perOutletPaise * outletCount };','''  const outletCount = Math.max(1, Number(outlets?.n ?? 1), t.commercial?.outletCount ?? 1);
  const included = (key: keyof typeof ADDONS) => key === "waiterApp" ? ["growth", "pro"].includes(t.planCode) : t.planCode === "pro";
  const addonPaise = t.commercial ? (Object.keys(ADDONS) as (keyof typeof ADDONS)[]).reduce((sum,key) => sum + (included(key) ? 0 : ADDONS[key].paise * new Set(t.commercial?.addons[key] ?? []).size), 0) : 0;
  return { perOutletPaise, outletCount, totalPaise: t.commercial ? perOutletPaise + (outletCount - 1) * EXTRA_OUTLET_PAISE + addonPaise : perOutletPaise * outletCount, addonPaise, pricingVersion: t.commercial ? 1 : 0 };
}

function quotedFee(fee: Awaited<ReturnType<typeof monthlyFee>>, months: number, target?: { code: string; monthlyPricePaise: number } | null) {
  if (!fee.pricingVersion) return (target ? target.monthlyPricePaise * fee.outletCount : fee.totalPaise) * months;
  // A plan change can include add-ons that used to be paid. Re-read the quote for a target below.
  return subscriptionQuote(target?.monthlyPricePaise ?? fee.perOutletPaise, fee.outletCount, months, fee.addonPaise).totalPaise;''')
s=s.replace('const perMonth = target ? target.monthlyPricePaise * fee.outletCount : fee.totalPaise;', 'const amountPaise = await quotedTargetFee(staff.tenantId, fee, months, target);');s=s.replace('amountPaise: perMonth * months','amountPaise').replace('((perMonth * months) / 100)','(amountPaise / 100)')
# target add-on price inclusion logic isolated
pos=s.index('/**\n * Adds the paid months')
s=s[:pos]+'''async function quotedTargetFee(tenantId: string, fee: Awaited<ReturnType<typeof monthlyFee>>, months: number, target: { code: string; monthlyPricePaise: number } | null) {
  if (!target || !fee.pricingVersion) return quotedFee(fee, months, target);
  const [row] = await db.select({ commercial: s.tenants.commercial }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  const addonPaise = (Object.keys(ADDONS) as (keyof typeof ADDONS)[]).reduce((sum,key) => sum + ((target.code === "pro" || (key === "waiterApp" && target.code === "growth")) ? 0 : ADDONS[key].paise * new Set(row?.commercial?.addons[key] ?? []).size),0);
  return subscriptionQuote(target.monthlyPricePaise, fee.outletCount, months, addonPaise).totalPaise;
}

'''+s[pos:];p.write_text(s)
p=Path('src/app/(console)/console/(app)/_components/plan-panel.tsx');s=p.read_text();s='import { ADDONS, EXTRA_OUTLET_PAISE, subscriptionQuote } from "@/lib/subscription-pricing";\n'+s if not s.startswith('"use client"') else s.replace('"use client";','"use client";\nimport { ADDONS, EXTRA_OUTLET_PAISE, subscriptionQuote } from "@/lib/subscription-pricing";',1)
s=s.replace('totalPaise: number };','totalPaise: number; pricingVersion?: number; addonPaise?: number; addonCounts?: Partial<Record<keyof typeof ADDONS, number>> };',1)
# target fee all locations use shared helper
s=s.replace('p.monthlyPricePaise * plan.fee.outletCount','planMonthly(plan, p)').replace('(target.monthlyPricePaise ?? 0) * plan.fee.outletCount','planMonthly(plan, target)').replace('target.monthlyPricePaise * plan.fee.outletCount','planMonthly(plan, target)')
s=s.replace('money(perMonth * m)', 'money(periodPrice(plan, target, m))').replace('money(perMonth * months)', 'money(periodPrice(plan, target, months))')
s=s.replace('<span className="text-body font-semibold">{m === 12 ? "1 yr" : `${m} mo`}</span>','<span className="text-body font-semibold">{m === 12 ? "1 yr" : `${m} mo`}{plan.fee.pricingVersion ? ` · ${({1:0,3:8,6:12,12:18})[m]}% off` : ""}</span>')
s+='''
function targetAddons(plan: PlanView, target?: PlanOption | null) {
 if (!target) return plan.fee.addonPaise ?? 0;
 return (Object.keys(ADDONS) as (keyof typeof ADDONS)[]).reduce((n,k) => n + ((target.code === "pro" || (k === "waiterApp" && target.code === "growth")) ? 0 : (plan.fee.addonCounts?.[k] ?? 0)*ADDONS[k].paise),0);
}
function planMonthly(plan: PlanView, target: PlanOption) {
 return plan.fee.pricingVersion ? (target.monthlyPricePaise ?? 0) + (plan.fee.outletCount-1)*EXTRA_OUTLET_PAISE + targetAddons(plan,target) : (target.monthlyPricePaise ?? 0)*plan.fee.outletCount;
}
function periodPrice(plan: PlanView, target: PlanOption | null | undefined, months: number) {
 return plan.fee.pricingVersion ? subscriptionQuote(target?.monthlyPricePaise ?? plan.fee.perOutletPaise,plan.fee.outletCount,months,targetAddons(plan,target)).totalPaise : (target ? planMonthly(plan,target) : plan.fee.totalPaise)*months;
}
''';p.write_text(s)
p=Path('src/app/(console)/console/(app)/menu/_components/menu-manager.tsx');s=p.read_text().replace('className={act} disabled={newSizes.length>=20}', 'className="rounded-xl border px-3 py-2 text-sm" disabled={newSizes.length>=20}');p.write_text(s)
