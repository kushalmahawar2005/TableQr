"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ADDONS, BUSINESS_TYPES, BUSINESS_SIZES, businessSizesFor, setupFee, type BusinessSize, type BusinessType, type CommercialSettings } from "@/lib/subscription-pricing";
import { getCommercialAction, saveCommercialAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const select = "h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm";
const heading = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** What the restaurant is, what was agreed, and the setup money: saved together for one tenant */
export function CommercialForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [data,setData] = useState<NonNullable<Awaited<ReturnType<typeof getCommercialAction>>["data"]>|null>(null);
  const [category,setCategory] = useState<BusinessType>("restaurant");
  const [businessSize,setBusinessSize] = useState<BusinessSize | "">("");
  const [count,setCount] = useState(1), [received,setReceived] = useState("0"), [reference,setReference] = useState("");
  const [addons,setAddons] = useState<CommercialSettings["addons"]>({});
  const [message,setMessage] = useState(""); const [busy,start] = useTransition();
  useEffect(()=>{let active=true;void getCommercialAction(tenantId).then(r=>{if(!active)return;if(!r.data){setMessage(r.error??"Could not load");return;}setData(r.data);setCategory(r.data.businessType??"restaurant");setBusinessSize(r.data.businessSize??"");setCount(r.data.commercial?.outletCount??Math.max(1,r.data.outlets.length));setAddons(r.data.commercial?.addons??{});setReceived(String((r.data.commercial?.setupReceivedPaise??0)/100));setReference(r.data.commercial?.setupReference??"");});return()=>{active=false}},[tenantId]);
  const save=(goLive:boolean)=>start(async()=>{const r=await saveCommercialAction(tenantId,{businessType:category,businessSize:businessSizesFor(category).length?businessSize as BusinessSize:null,outletCount:count,addons,setupReceivedRupees:Number(received),setupReference:reference,goLive});setMessage(r.error??"Saved.");if(!r.error){const next=await getCommercialAction(tenantId);setData(next.data);router.refresh();}});
  const toggleAddon=(key:keyof typeof ADDONS,outletId:string,on:boolean)=>setAddons(old=>({...old,[key]:on?[...(old[key]??[]),outletId]:(old[key]??[]).filter(id=>id!==outletId)}));
  if(!data)return <p role="status" className="text-sm text-muted-foreground">{message||"Loading…"}</p>;
  const sizes=businessSizesFor(category);
  const oneOutlet=data.outlets.length===1;
  return <div className="space-y-5 text-sm">
    <div className="space-y-3">
      <p className={heading}>Business</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor={`category-${tenantId}`}>Category</Label><select id={`category-${tenantId}`} className={select} value={category} onChange={e=>{const next=e.target.value as BusinessType;setCategory(next);setBusinessSize(businessSizesFor(next)[0]?.[0]??"")}}>{Object.entries(BUSINESS_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
        {sizes.length>0&&<div className="space-y-1.5"><Label htmlFor={`size-${tenantId}`}>Size</Label><select id={`size-${tenantId}`} className={select} value={businessSize} onChange={e=>setBusinessSize(e.target.value as BusinessSize)}><option value="">Choose size</option>{sizes.map(([key])=><option key={key} value={key}>{BUSINESS_SIZES[key]}</option>)}</select></div>}
        <div className="space-y-1.5"><Label htmlFor={`outlets-${tenantId}`}>Outlets agreed</Label><Input id={`outlets-${tenantId}`} type="number" min={Math.max(1,data.outlets.length)} max={1000} value={count} onChange={e=>setCount(Number(e.target.value))}/></div>
      </div>
      <p className="text-xs text-muted-foreground">Setup total ₹{(setupFee(count)/100).toLocaleString("en-IN")} · Extra outlets ₹400 a month each</p>
    </div>
    <div className="space-y-2">
      <p className={heading}>Add-ons</p>
      {(Object.keys(ADDONS) as (keyof typeof ADDONS)[]).map(key=>{const addon=ADDONS[key];const price=addon.paise===0?"Included":`₹${addon.paise/100} per outlet a month`;
        return oneOutlet
          ?<label key={key} className="flex min-h-10 items-center gap-2.5"><input type="checkbox" className="size-4 shrink-0 accent-[var(--admin-brand)]" checked={addons[key]?.includes(data.outlets[0].id)??false} onChange={e=>toggleAddon(key,data.outlets[0].id,e.target.checked)}/><span className="min-w-0 flex-1">{addon.label}</span><span className="shrink-0 text-xs text-muted-foreground">{price}</span></label>
          :<fieldset key={key} className="rounded-lg border p-3"><legend className="px-1 font-semibold">{addon.label} <span className="font-normal text-muted-foreground">· {price}</span></legend>{data.outlets.map(o=><label key={o.id} className="flex min-h-9 items-center gap-2.5"><input type="checkbox" className="size-4 shrink-0 accent-[var(--admin-brand)]" checked={addons[key]?.includes(o.id)??false} onChange={e=>toggleAddon(key,o.id,e.target.checked)}/>{o.name}</label>)}</fieldset>;})}
    </div>
    <div className="space-y-3">
      <p className={heading}>Setup payment</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor={`received-${tenantId}`}>Amount received (₹)</Label><Input id={`received-${tenantId}`} type="number" min={0} step="0.01" value={received} onChange={e=>setReceived(e.target.value)}/></div>
        <div className="space-y-1.5"><Label htmlFor={`reference-${tenantId}`}>Reference</Label><Input id={`reference-${tenantId}`} value={reference} maxLength={120} onChange={e=>setReference(e.target.value)}/></div>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">Remote onboarding. Hardware not provided. All selected recurring features are free for one month from go-live. Setup fees do not extend the subscription.</p>
    {data.commercial?.goLiveAt&&<p className="font-medium">Live since {new Date(data.commercial.goLiveAt).toLocaleDateString("en-IN")}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>save(false)}>Save</Button>{!data.commercial?.goLiveAt&&<Button disabled={busy} variant="outline" onClick={()=>save(true)}>Go live & start free month</Button>}</div>
    {message&&<p role="status" className="font-medium">{message}</p>}
  </div>;
}
