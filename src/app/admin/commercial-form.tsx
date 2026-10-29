"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ADDONS, BUSINESS_TYPES, setupFee, type BusinessType, type CommercialSettings } from "@/lib/subscription-pricing";
import { getCommercialAction, saveCommercialAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function CommercialForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [data,setData] = useState<NonNullable<Awaited<ReturnType<typeof getCommercialAction>>["data"]>|null>(null);
  const [category,setCategory] = useState<BusinessType>("restaurant");
  const [count,setCount] = useState(1), [received,setReceived] = useState("0"), [reference,setReference] = useState("");
  const [addons,setAddons] = useState<CommercialSettings["addons"]>({});
  const [message,setMessage] = useState(""); const [busy,start] = useTransition();
  useEffect(()=>{let active=true;void getCommercialAction(tenantId).then(r=>{if(!active)return;if(!r.data){setMessage(r.error??"Could not load");return;}setData(r.data);setCategory(r.data.businessType??"restaurant");setCount(r.data.commercial?.outletCount??Math.max(1,r.data.outlets.length));setAddons(r.data.commercial?.addons??{});setReceived(String((r.data.commercial?.setupReceivedPaise??0)/100));setReference(r.data.commercial?.setupReference??"");});return()=>{active=false}},[tenantId]);
  const save=(goLive:boolean)=>start(async()=>{const r=await saveCommercialAction(tenantId,{businessType:category,outletCount:count,addons,setupReceivedRupees:Number(received),setupReference:reference,goLive});setMessage(r.error??"Saved subscription settings.");if(!r.error){const next=await getCommercialAction(tenantId);setData(next.data);router.refresh();}});
  if(!data)return <p role="status">{message||"Loading subscription settings…"}</p>;
  return <section className="space-y-3 rounded-lg border p-3 text-sm"><h3 className="font-semibold">Business & subscription setup</h3>
    <label className="block">Business category<select className="mt-1 w-full rounded border bg-background p-2" value={category} onChange={e=>setCategory(e.target.value as BusinessType)}>{Object.entries(BUSINESS_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label className="block">Total outlets agreed<Input type="number" min={Math.max(1,data.outlets.length)} max={1000} value={count} onChange={e=>setCount(Number(e.target.value))}/></label>
    <p>Setup total: ₹{(setupFee(count)/100).toLocaleString("en-IN")} · Extra outlets: ₹400/month each.</p>
    {Object.entries(ADDONS).map(([key,addon])=><fieldset key={key} className="space-y-1 rounded border p-2"><legend>{addon.label} · ₹{addon.paise/100}/outlet/month</legend><p className="text-xs text-muted-foreground">Already included in the plan? No extra charge.</p>{data.outlets.map(o=><label key={o.id} className="flex items-center gap-2"><input type="checkbox" checked={addons[key as keyof typeof ADDONS]?.includes(o.id)??false} onChange={e=>setAddons(old=>({...old,[key]:e.target.checked?[...(old[key as keyof typeof ADDONS]??[]),o.id]:(old[key as keyof typeof ADDONS]??[]).filter(id=>id!==o.id)}))}/>{o.name}</label>)}</fieldset>)}
    <label className="block">Total setup amount received (₹)<Input type="number" min={0} step="0.01" value={received} onChange={e=>setReceived(e.target.value)}/></label>
    <label className="block">Setup payment reference<Input value={reference} maxLength={120} onChange={e=>setReference(e.target.value)}/></label>
    <p className="text-xs text-muted-foreground">Remote onboarding. Hardware not provided. All selected recurring features are free for one month from go-live. Setup fees do not extend the subscription.</p>
    {data.commercial?.goLiveAt&&<p>Live since {new Date(data.commercial.goLiveAt).toLocaleDateString("en-IN")}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>save(false)}>Save settings</Button>{!data.commercial?.goLiveAt&&<Button disabled={busy} variant="outline" onClick={()=>save(true)}>Go live & start free month</Button>}</div>
    {message&&<p role="status">{message}</p>}
  </section>;
}
