import { describe, expect, it } from "vitest";
import { freeMonthEnd, setupFee, subscriptionQuote } from "@/lib/subscription-pricing";
import { DEFAULT_PLANS, readFeatures } from "@/lib/plan-features";
import { effectiveFeatures } from "@/server/plan";
describe("agreed subscription pricing",()=>{
 it("charges extra outlets once and discounts only the agreed subscription portion",()=>{
  expect(subscriptionQuote(69900,2,1,59800).totalPaise).toBe(169700);
  expect(subscriptionQuote(69900,1,3).totalPaise).toBe(192924);
  expect(subscriptionQuote(69900,2,3,59800).totalPaise).toBe(482724);
  expect(subscriptionQuote(220000,3,12).totalPaise).toBe(2952000);
  expect(setupFee(2)).toBe(649900);
 });
 it("rejects invalid billing terms",()=>{expect(()=>subscriptionQuote(69900,1,2)).toThrow();expect(()=>subscriptionQuote(69900,0,1)).toThrow();});
 it("starts one calendar month from go-live without skipping February",()=>{expect(freeMonthEnd(new Date('2026-01-31T09:00:00Z')).toISOString()).toBe('2026-02-28T09:00:00.000Z');});
 it("separates business category from paid features and scopes add-ons to the purchased outlet",()=>{
  const base=DEFAULT_PLANS.find(p=>p.code==='starter')!.features;
  const row={features:base,customFeatures:null,kitchenOverride:null,tableLimit:null};
  expect(effectiveFeatures({...row,businessType:'cloud_kitchen'})).toMatchObject({dineIn:false,rooms:false,reservations:false,kitchenDisplay:true});
  expect(effectiveFeatures({...row,businessType:'hotel'})).toMatchObject({dineIn:false,rooms:true,delivery:false});
  expect(effectiveFeatures({...row,businessType:'hotel_restaurant'})).toMatchObject({dineIn:true,rooms:true});
  const commercial={version:1 as const,outletCount:2,addons:{waiterApp:['one']},goLiveAt:null,setupReceivedPaise:0,setupReference:''};
  expect(effectiveFeatures({...row,commercial,outletId:'one'}).waiterApp).toBe(true);
  expect(effectiveFeatures({...row,commercial,outletId:'two'}).waiterApp).toBe(false);
  expect(effectiveFeatures({...row,businessType:'cloud_kitchen',commercial:{...commercial,addons:{reservations:['one']}},outletId:'one'})).toMatchObject({dineIn:false,reservations:true});
  expect(effectiveFeatures({...row,businessType:'cloud_kitchen',commercial:{...commercial,addons:{reservations:['one']}},outletId:'two'})).toMatchObject({dineIn:false,reservations:false});
  expect(readFeatures(base)).toMatchObject({waiterApp:false,purchasing:false,recipeCosting:false});
 });
});
