"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Dices, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTenantAction, type TenantState } from "./actions";

type Field = { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; hint?: string; full?: boolean };

const sections: { title: string; fields: Field[] }[] = [
  { title: "Business", fields: [
    { name: "tenantName", label: "Company name", required: true, hint: "The business that pays for TableQR, e.g. Sharma Hospitality Pvt Ltd" },
    { name: "brandName", label: "Brand name", hint: "The restaurant name guests see. Leave empty to use the company name" },
    { name: "contactName", label: "Contact person", required: true },
    { name: "contactPhone", label: "Contact phone", type: "tel", required: true },
    { name: "contactEmail", label: "Contact email", type: "email" },
  ] },
  { title: "First outlet", fields: [
    { name: "outletName", label: "Outlet name", required: true, hint: "This location, e.g. Spice Route - Jaipur" },
    { name: "outletCode", label: "Outlet code", hint: "Made from the outlet name. You can change it. The owner signs in with it" },
    { name: "city", label: "City", required: true },
    { name: "tableCount", label: "Number of tables", type: "number", required: true, defaultValue: "4" },
    { name: "address", label: "Address", required: true, full: true },
  ] },
  { title: "Owner login", fields: [
    { name: "ownerName", label: "Owner name", required: true },
    { name: "ownerPhone", label: "Owner phone", type: "tel", required: true },
    { name: "ownerPin", label: "4-digit PIN", type: "password", required: true, hint: "The owner signs in with this. Tap Generate for a random one" },
  ] },
];

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateTenantDialog({ open, onOpenChange, plans }: { open: boolean; onOpenChange: (open: boolean) => void; plans: { code: string; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<TenantState, FormData>(createTenantAction, { error: null, success: null });

  const [pin, setPin] = useState("");
  const [outletName, setOutletName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [digits, setDigits] = useState(() => String(Math.floor(Math.random() * 100)).padStart(2, "0"));

  // Suggest a code from the outlet name (e.g. "Spice Route" -> SPI42) until the person types their own.
  const suggest = (name: string, d: string) => {
    const prefix = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    return prefix.length >= 2 ? `${prefix}${d}` : "";
  };
  const changeOutletName = (value: string) => {
    setOutletName(value);
    if (!codeEdited) setCode(suggest(value, digits));
  };
  const regenerateCode = () => {
    const d = String(Math.floor(Math.random() * 100)).padStart(2, "0");
    setDigits(d);
    setCodeEdited(false);
    setCode(suggest(outletName, d));
  };
  const [creds, setCreds] = useState<{ tenant: string; outlet: string; phone: string; pin: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (state.success) router.refresh(); }, [state.success, router]);

  const generatePin = () => {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    setPin(String(n[0] % 10000).padStart(4, "0"));
  };

  const outletForCreds = state.outletCode ?? creds?.outlet ?? "";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || (typeof window === "undefined" ? "" : window.location.origin);
  const loginUrl = `${appUrl}/console/login`;
  const message = creds ? `Hi! Your TableQR account for ${creds.tenant} is ready.\n\nSign in: ${loginUrl}\nOutlet code: ${outletForCreds}\nPhone: ${creds.phone}\nPIN: ${creds.pin}\n\nPlease change your PIN after signing in.` : "";
  const waNumber = creds ? (creds.phone.replace(/\D/g, "").length === 10 ? `91${creds.phone.replace(/\D/g, "")}` : creds.phone.replace(/\D/g, "")) : "";
  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Add tenant</DialogTitle>
        <DialogDescription>Creates the company, its first outlet, owner login, tables and QR codes.</DialogDescription>
      </DialogHeader>
      {state.success && creds ? <div className="space-y-4 py-2">
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{creds.tenant} has been created. Share these sign-in details with the owner.</p>
        <dl className="divide-y rounded-xl border text-sm">
          {([["Sign-in page", loginUrl], ["Outlet code", outletForCreds], ["Phone", creds.phone], ["PIN", creds.pin]] as const).map(([k, v]) => <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-all text-right font-mono font-medium">{v}</dd></div>)}
        </dl>
        <p className="text-xs text-muted-foreground">The PIN is shown only now. If it is lost, reset it from the tenant&apos;s Manage tab.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy details"}</Button>
          <Button render={<a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener" />} nativeButton={false}><MessageCircle />Send on WhatsApp</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </div> : <form action={(fd) => { setCreds({ tenant: String(fd.get("tenantName") ?? ""), outlet: String(fd.get("outletCode") ?? "").toUpperCase(), phone: String(fd.get("ownerPhone") ?? ""), pin: String(fd.get("ownerPin") ?? "") }); action(fd); }} className="space-y-6">
        {sections.map((section) => <fieldset key={section.title} className="space-y-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2">{section.fields.map((f) => <div key={f.name} className={f.full ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Label htmlFor={f.name}>{f.label}{f.required && <span className="text-red-500"> *</span>}</Label>
            {f.name === "outletCode" ? <div className="flex gap-2">
              <Input id={f.name} name={f.name} value={code} onChange={(e) => { setCodeEdited(true); setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)); }} placeholder="Fills in from the outlet name" maxLength={12} autoComplete="off" className="font-mono uppercase" />
              <Button type="button" variant="outline" onClick={regenerateCode} disabled={!outletName.trim()}><Dices />New</Button>
            </div> : f.name === "outletName" ? <Input id={f.name} name={f.name} value={outletName} onChange={(e) => changeOutletName(e.target.value)} required />
            : f.name === "ownerPin" ? <div className="flex gap-2">
              <Input id={f.name} name={f.name} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} required pattern="\d{4}" maxLength={4} inputMode="numeric" autoComplete="off" />
              <Button type="button" variant="outline" onClick={generatePin}><Dices />Generate</Button>
            </div> : <Input id={f.name} name={f.name} type={f.type ?? "text"} required={f.required} defaultValue={f.defaultValue}
              min={f.name === "tableCount" ? 1 : undefined} max={f.name === "tableCount" ? 100 : undefined} />}
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>)}</div>
        </fieldset>)}
        <fieldset className="space-y-1.5">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan</legend>
          <select name="planCode" required className={selectClass} aria-label="Plan">{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
        </fieldset>
        {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{pending ? "Creating…" : "Create tenant"}</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
