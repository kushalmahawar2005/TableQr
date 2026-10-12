"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Package, Plus, Search, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { priceLine } from "@/domain/pricing";
import * as waiter from "@/app/(staff)/waiter/actions";
import * as pos from "@/server/staff/pos-actions";
import type { PosBillDetail } from "@/server/staff/pos-read";
import type { WaiterMenu } from "@/server/staff/waiter-read";

type Line = { key: string; item: WaiterMenu[number]; qty: number; mods: string[]; parcel: boolean };
const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const primary = cn(buttonVariants({ variant: "default" }), "h-11 w-full gap-2 text-sm");
const field = "h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring";

/** Add dishes to a table's running bill, optionally marked as parcel (packed to take away). */
export function AddItemsDialog({ detail, open, hi, onClose, onPlaced }: { detail: PosBillDetail; open: boolean; hi: boolean; onClose: () => void; onPlaced: () => Promise<void> }) {
  const [menu, setMenu] = useState<WaiterMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [person, setPerson] = useState("");
  const [newGuest, setNewGuest] = useState("");
  const [busy, setBusy] = useState(false);
  const L = (en: string, h: string) => (hi ? h : en);
  const people = detail.people.filter((p) => !p.paidOutAt);

  useEffect(() => {
    if (!open || menu) return;
    let off = false;
    waiter.menuAction().then((r) => { if (off) return; if (r.ok) setMenu(r.data); else setError(r.error); });
    return () => { off = true; };
  }, [open, menu]);
  const who = person || people[0]?.id || "";

  const shown = useMemo(() => (menu ?? []).filter((m) => !query.trim() || `${m.name} ${m.nameHi ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())), [menu, query]);
  const price = (l: Line) => { const r = priceLine(l.item.pricing, l.qty, l.mods); return r.ok ? r.line.linePaise : 0; };
  const total = cart.reduce((n, l) => n + price(l), 0);
  const count = cart.reduce((n, l) => n + l.qty, 0);
  const missing = (l: Line) => l.item.pricing.groups.find((g) => g.minSelect > 0 && g.modifiers.filter((m) => l.mods.includes(m.id)).length < g.minSelect);
  const incomplete = cart.some((l) => missing(l));
  const pick = (l: Line, g: Line["item"]["pricing"]["groups"][number], id: string, on: boolean) => {
    const others = l.mods.filter((x) => !g.modifiers.some((m) => m.id === x));
    const mine = l.mods.filter((x) => g.modifiers.some((m) => m.id === x));
    const next = g.maxSelect === 1 ? (on ? [id] : []) : on ? [...mine, id].slice(0, g.maxSelect) : mine.filter((x) => x !== id);
    change(l.key, { mods: [...others, ...next] });
  };

  const add = (item: WaiterMenu[number]) => setCart((c) => {
    const needsChoice = item.pricing.groups.some((g) => g.minSelect > 0);
    const same = needsChoice ? undefined : c.find((l) => l.item.id === item.id && l.parcel === !!detail.takeaway && l.mods.length === 0);
    return same ? c.map((l) => (l === same ? { ...l, qty: Math.min(50, l.qty + 1) } : l)) : [...c, { key: `${item.id}-${Date.now()}`, item, qty: 1, mods: [], parcel: !!detail.takeaway }];
  });
  const change = (key: string, patch: Partial<Line>) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  const reset = () => { setCart([]); setQuery(""); setError(null); setNewGuest(""); };

  const place = async () => {
    setError(null);
    for (const l of cart) { const r = priceLine(l.item.pricing, l.qty, l.mods); if (!r.ok) return setError(`${l.item.name}: ${L("choose valid options", "सही विकल्प चुनें")}`); }
    setBusy(true);
    try {
      let participantId = who;
      if (!participantId || newGuest.trim()) {
        const d = await waiter.addDinerAction(detail.sessionId, newGuest.trim());
        if (!d.ok) return setError(d.error);
        participantId = d.data.id;
      }
      // Billing adds through its own action, which also handles a bill that was already asked for
      const r = await pos.addItemsAction({ sessionId: detail.sessionId, tableId: detail.tableId, participantId, clientRequestId: crypto.randomUUID(), lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty, modifierIds: l.mods, note: l.parcel ? "PARCEL" : undefined })) });
      if (!r.ok) return setError(r.error);
      reset();
      await onPlaced();
      onClose();
    } catch { setError(L("Could not place the order. Try again.", "ऑर्डर नहीं हो सका। फिर कोशिश करें।")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="no-scrollbar max-h-[92dvh] gap-3 overflow-y-auto p-5 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-title font-bold">{L("Add items", "आइटम जोड़ें")} · {detail.takeaway ? L("Takeaway", "पार्सल") : L("Table", "टेबल")} {detail.tableCode}</DialogTitle>
          <DialogDescription>{detail.status === "bill_requested" ? L("Handed over at the counter (a chocolate, water, mouth freshener): added to the bill, not sent to the kitchen.", "काउंटर पर दिए जाने वाले आइटम (चॉकलेट, पानी, सौंफ): बिल में जुड़ेंगे, किचन को नहीं जाएँगे।") : L("These go to the kitchen and are added to the bill. Mark an item as parcel to have it packed.", "ये किचन को जाएँगे और बिल में जुड़ेंगे। पैक कराने के लिए पार्सल चुनें।")}</DialogDescription>
        </DialogHeader>

        <div>
          <p className="text-sm font-semibold">{detail.takeaway ? L("Guest name (optional)", "ग्राहक का नाम (वैकल्पिक)") : L("For whom?", "किसके लिए?")}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {people.map((p) => <button key={p.id} type="button" aria-pressed={who === p.id && !newGuest.trim()} onClick={() => { setPerson(p.id); setNewGuest(""); }} className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${who === p.id && !newGuest.trim() ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"}`}>{p.name}</button>)}
            <div className="relative min-w-40 flex-1"><UserPlus className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input value={newGuest} onChange={(e) => setNewGuest(e.target.value)} placeholder={L("New guest name", "नया नाम")} className={`${field} h-10 pl-8`} /></div>
          </div>
        </div>

        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("Search the menu", "मेन्यू खोजें")} aria-label={L("Search the menu", "मेन्यू खोजें")} className={`${field} pl-9`} /></div>

        <div className="no-scrollbar max-h-64 overflow-y-auto rounded-lg border border-border">
          {!menu && !error && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{L("Loading the menu…", "मेन्यू लोड हो रहा है…")}</p>}
          {menu && shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">{L("Nothing matches.", "कुछ नहीं मिला।")}</p>}
          <ul className="divide-y divide-border">
            {shown.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{hi ? m.nameHi || m.name : m.name}</p><p className="text-xs text-muted-foreground tabular-nums">{rs(m.pricing.pricePaise)}{!m.pricing.isAvailable ? ` · ${L("sold out", "खत्म")}` : ""}</p></div>
                <button type="button" disabled={!m.pricing.isAvailable} onClick={() => add(m)} aria-label={`${L("Add", "जोड़ें")} ${m.name}`} className="grid size-9 shrink-0 place-items-center rounded-lg border border-border hover:bg-secondary disabled:opacity-40"><Plus className="size-4" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </div>

        {cart.length > 0 && (
          <div>
            <p className="text-sm font-semibold">{L("Your list", "आपकी सूची")}</p>
            <ul className="mt-1.5 space-y-2">
              {cart.map((l) => (
                <li key={l.key} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold">{hi ? l.item.nameHi || l.item.name : l.item.name}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button type="button" aria-label={L("One less", "एक कम")} onClick={() => change(l.key, { qty: l.qty - 1 })} className="grid size-8 place-items-center rounded-md border border-border hover:bg-secondary"><Minus className="size-3.5" aria-hidden="true" /></button>
                      <span className="w-6 text-center text-sm font-bold tabular-nums">{l.qty}</span>
                      <button type="button" aria-label={L("One more", "एक और")} onClick={() => change(l.key, { qty: Math.min(50, l.qty + 1) })} className="grid size-8 place-items-center rounded-md border border-border hover:bg-secondary"><Plus className="size-3.5" aria-hidden="true" /></button>
                      <span className="w-16 text-right text-sm tabular-nums">{rs(price(l))}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" aria-pressed={l.parcel} onClick={() => change(l.key, { parcel: !l.parcel })} className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${l.parcel ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"}`}><Package className="size-3.5" aria-hidden="true" />{L("Parcel", "पार्सल")}</button>
                  </div>
                  {l.item.pricing.groups.filter((g) => g.modifiers.length > 0).map((g) => {
                    const need = g.minSelect > 0 && g.modifiers.filter((m) => l.mods.includes(m.id)).length < g.minSelect;
                    return (
                      <div key={g.id} className="mt-2">
                        <p className={`text-xs font-semibold ${need ? "text-destructive" : "text-muted-foreground"}`}>{hi ? g.nameHi || g.nameEn : g.nameEn}{g.minSelect > 0 ? ` · ${need ? L("choose one", "एक चुनें") : L("required", "ज़रूरी")}` : ` · ${L("optional", "वैकल्पिक")}`}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {g.modifiers.map((mod) => {
                            const on = l.mods.includes(mod.id);
                            return (
                              <button key={mod.id} type="button" role={g.maxSelect === 1 ? "radio" : "checkbox"} aria-checked={on} disabled={!mod.isAvailable} onClick={() => pick(l, g, mod.id, g.maxSelect === 1 && g.minSelect > 0 ? true : !on)} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold disabled:opacity-40 ${on ? "border-primary bg-primary/10" : need ? "border-destructive/50" : "border-border text-muted-foreground hover:text-foreground"}`}>
                                {hi ? mod.nameHi || mod.nameEn : mod.nameEn}{mod.priceDeltaPaise ? ` +${rs(mod.priceDeltaPaise)}` : ""}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
        <button type="button" className={primary} disabled={busy || cart.length === 0 || incomplete} onClick={() => void place()}>{busy ? L("Adding…", "जोड़ रहे हैं…") : incomplete ? L("Choose the required option (size)", "ज़रूरी विकल्प (साइज़) चुनें") : cart.length ? `${L("Add to bill", "बिल में जोड़ें")} · ${count} ${count === 1 ? L("item", "आइटम") : L("items", "आइटम")} · ${rs(total)}` : L("Pick something to add", "कुछ चुनें")}</button>
      </DialogContent>
    </Dialog>
  );
}
