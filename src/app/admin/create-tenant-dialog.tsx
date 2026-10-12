"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, Dices, Loader2, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SuggestInput, type Suggestion } from "@/components/suggest-input";
import { searchCities } from "@/domain/india-cities";
import { createTenantAction, type TenantState } from "./actions";

// City suggestions come from the built-in list; address suggestions from OpenStreetMap (Photon,
// free, no key), kept inside India and leaning on the city typed above
const suggestCity = (text: string): Suggestion[] => searchCities(text).map((c) => ({ value: c.name, label: c.name, hint: c.state }));
type PhotonFeature = { properties: Record<string, string | undefined> };
async function suggestAddress(text: string): Promise<Suggestion[]> {
  const city = (document.getElementById("city") as HTMLInputElement | null)?.value.trim() ?? "";
  const q = city && !text.toLowerCase().includes(city.toLowerCase()) ? `${text}, ${city}` : text;
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=68.1,6.5,97.4,35.7`);
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  return (data.features ?? []).flatMap(({ properties: p }) => {
    if (p.countrycode && p.countrycode !== "IN") return [];
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const parts = [p.name, street, p.locality ?? p.district, p.city ?? p.county, p.state, p.postcode].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
    const value = parts.join(", ");
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [{ value, label: parts.slice(0, 2).join(", "), hint: parts.slice(2).join(", ") }];
  });
}

type Field = { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; hint?: string; full?: boolean };

// Onboarding in four short steps; every field stays in one form, so going back keeps what was typed
const sections: { title: string; help: string; fields: Field[] }[] = [
  { title: "Restaurant", help: "Who you are setting up", fields: [
    { name: "brandName", label: "Brand name", required: true, hint: "The restaurant name guests see, e.g. Spice Route" },
    { name: "contactName", label: "Contact person", required: true },
    { name: "contactPhone", label: "Contact phone", type: "tel", required: true },
    { name: "contactEmail", label: "Contact email", type: "email" },
  ] },
  { title: "Location", help: "Where it is and how many tables", fields: [
    { name: "outletName", label: "Outlet name", required: true, hint: "This location, e.g. Spice Route - Jaipur" },
    { name: "outletCode", label: "Outlet code", hint: "Made from the outlet name. You can change it. The owner signs in with it" },
    { name: "city", label: "City", required: true },
    { name: "tableCount", label: "Number of tables", type: "number", required: true, defaultValue: "4", hint: "Also the most tables this restaurant can have. Change it later under the tenant." },
    { name: "address", label: "Address", required: true, full: true },
  ] },
  { title: "Owner login", help: "How the owner signs in", fields: [
    { name: "ownerName", label: "Owner name", required: true },
    { name: "ownerPhone", label: "Owner phone", type: "tel", required: true },
    { name: "ownerPin", label: "4-digit PIN", type: "password", required: true, hint: "The owner signs in with this. Tap Generate for a random one" },
  ] },
];

export function CreateTenantDialog({ open, onOpenChange, plans }: { open: boolean; onOpenChange: (open: boolean) => void; plans: { code: string; name: string; kitchen: boolean }[] }) {
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
  const [step, setStep] = useState(0);
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? "");
  // Kitchen screen follows the chosen plan until the admin sets it themselves
  const [kitchen, setKitchen] = useState<boolean | null>(null);
  const kitchenOn = kitchen ?? plans.find((p) => p.code === planCode)?.kitchen ?? false;
  const [review, setReview] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const last = sections.length; // the plan and review step comes after the field sections
  const field = (name: string) => form.current?.elements.namedItem(name) as HTMLInputElement | null;

  /** Checks this step's fields with the browser's own messages; true when all are fine */
  const stepValid = () => {
    const els = form.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-step="${step}"] :is(input, select)`) ?? [];
    for (const el of els) if (!el.checkValidity()) { el.reportValidity(); return false; }
    return true;
  };
  const next = () => {
    if (!stepValid()) return;
    // Sensible defaults for the next step, never overwriting what was typed
    if (step === 0 && !outletName.trim()) changeOutletName(field("brandName")?.value ?? "");
    if (step === 1) {
      const name = field("ownerName"), phone = field("ownerPhone");
      if (name && !name.value) name.value = field("contactName")?.value ?? "";
      if (phone && !phone.value) phone.value = field("contactPhone")?.value ?? "";
    }
    if (step === last - 1 && form.current) setReview(Object.fromEntries([...new FormData(form.current)].map(([k, v]) => [k, String(v)])));
    setStep(step + 1);
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
      </div> : <form ref={form} onSubmit={(e) => { if (step < last) e.preventDefault(); }} action={(fd) => { setCreds({ tenant: String(fd.get("brandName") ?? ""), outlet: String(fd.get("outletCode") ?? "").toUpperCase(), phone: String(fd.get("ownerPhone") ?? ""), pin: String(fd.get("ownerPin") ?? "") }); action(fd); }} onKeyDown={(e) => { if (e.key === "Enter" && step < last && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); next(); } }} className="space-y-5">
        <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
          {[...sections.map((s) => s.title), "Plan"].map((title, i) => <li key={title} aria-current={i === step ? "step" : undefined} className="space-y-1.5">
            <span className={`block h-1.5 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
            <span className="flex items-center gap-1.5 text-xs">
              <Badge variant={i <= step ? "default" : "outline"} className="size-5 justify-center rounded-full p-0">{i < step ? <Check className="size-3" /> : i + 1}</Badge>
              <span className={i === step ? "font-semibold text-foreground" : "text-muted-foreground"}>{title}</span>
            </span>
          </li>)}
        </ol>
        <Separator />
        {sections.map((section, i) => <fieldset key={section.title} data-step={i} className={i === step ? "space-y-3" : "hidden"}>
          <legend className="mb-1"><span className="block text-base font-semibold">{section.title}</span><span className="block text-sm text-muted-foreground">{section.help}</span></legend>
          <div className="grid gap-3 sm:grid-cols-2">{section.fields.map((f) => <div key={f.name} className={f.full ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Label htmlFor={f.name}>{f.label}{f.required && <span className="text-red-500"> *</span>}</Label>
            {f.name === "outletCode" ? <div className="flex gap-2">
              <Input id={f.name} name={f.name} value={code} onChange={(e) => { setCodeEdited(true); setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)); }} placeholder="Fills in from the outlet name" maxLength={12} autoComplete="off" className="font-mono uppercase" />
              <Button type="button" variant="outline" onClick={regenerateCode} disabled={!outletName.trim()}><Dices />New</Button>
            </div> : f.name === "outletName" ? <Input id={f.name} name={f.name} value={outletName} onChange={(e) => changeOutletName(e.target.value)} required />
            : f.name === "ownerPin" ? <div className="flex gap-2">
              <Input id={f.name} name={f.name} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} required pattern="\d{4}" maxLength={4} inputMode="numeric" autoComplete="off" />
              <Button type="button" variant="outline" onClick={generatePin}><Dices />Generate</Button>
            </div> : f.name === "city" ? <SuggestInput id="city" name="city" required placeholder="Start typing, e.g. Jai" suggest={suggestCity} />
            : f.name === "address" ? <SuggestInput id="address" name="address" required minChars={4} placeholder="Shop, street or landmark" suggest={suggestAddress} />
            : <Input id={f.name} name={f.name} type={f.type ?? "text"} required={f.required} defaultValue={f.defaultValue}
              min={f.name === "tableCount" ? 1 : undefined} max={f.name === "tableCount" ? 100 : undefined} />}
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>)}</div>
        </fieldset>)}
        <fieldset data-step={last} className={step === last ? "space-y-4" : "hidden"}>
          <legend className="mb-1"><span className="block text-base font-semibold">Plan</span><span className="block text-sm text-muted-foreground">Pick a plan and check the details</span></legend>
          <div role="radiogroup" aria-label="Plan" className="grid gap-2 sm:grid-cols-2">
            {plans.map((p) => <label key={p.code} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
              <input type="radio" name="planCode" value={p.code} checked={planCode === p.code} onChange={() => setPlanCode(p.code)} required className="size-4 accent-[var(--primary)]" />
              <span className="font-medium">{p.name}</span>
              {p.kitchen && <span className="ml-auto text-xs text-muted-foreground">Kitchen included</span>}
            </label>)}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <input type="checkbox" checked={kitchenOn} onChange={(e) => setKitchen(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <input type="hidden" name="kitchenDisplay" value={kitchenOn ? "on" : "off"} />
            <span><span className="block font-medium">Kitchen screen</span><span className="block text-xs text-muted-foreground">Gives the Kitchen staff role and the wall kitchen screen. Comes with the plan when ticked by default; you can change it for this restaurant.</span></span>
          </label>
          <dl className="divide-y rounded-xl border text-sm">
            {([["Brand", review.brandName], ["Contact", [review.contactName, review.contactPhone].filter(Boolean).join(" · ")], ["Outlet", [review.outletName, review.city].filter(Boolean).join(", ")], ["Outlet code", review.outletCode || "Made when created"], ["Tables", review.tableCount], ["Owner", [review.ownerName, review.ownerPhone].filter(Boolean).join(" · ")], ["Kitchen screen", kitchenOn ? "Yes" : "No"]] as const).map(([k, v]) => <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words text-right font-medium">{v}</dd></div>)}
          </dl>
        </fieldset>
        {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
        <div className="flex justify-between gap-2">
          {step === 0 ? <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button> : <Button type="button" variant="outline" onClick={() => setStep(step - 1)} disabled={pending}><ArrowLeft />Back</Button>}
          {/* Separate keys: the click that shows the last step must not land on a fresh Create button */}
          {step < last ? <Button key="next" type="button" onClick={next}>Next<ArrowRight /></Button>
            : <Button key="create" type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{pending ? "Creating…" : "Create restaurant"}</Button>}
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
