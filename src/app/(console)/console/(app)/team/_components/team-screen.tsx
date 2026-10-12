"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Phone, Plus, Power, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { TeamMember } from "@/server/staff/team";
import type { DutyRow } from "@/server/staff/duty";
import { WhoIsWorking } from "./who-is-working";
import { addMemberAction, changeRoleAction, resetPinAction, setActiveAction } from "../actions";

const ALL_ROLES = [
  { id: "manager", label: "Manager", does: "Runs the outlet: floor, menu, billing, reports, approvals", opens: "Dashboard", path: "/console/dashboard" },
  { id: "waiter", label: "Waiter", does: "Takes orders at tables, serves, requests the bill", opens: "Waiter app", path: "/waiter" },
  { id: "accountant", label: "Accountant", does: "Takes payments, views bills and reports", opens: "Billing", path: "/pos" },
  { id: "kitchen", label: "Kitchen", does: "Sees orders and marks food ready. Signs in on the kitchen screen with this phone and PIN", opens: "Kitchen", path: "/console/kitchen" },
] as const;
// Older roles still shown on people who have them
const LABEL: Record<string, string> = { owner: "Owner", cashier: "Cashier", host: "Host", ...Object.fromEntries(ALL_ROLES.map((r) => [r.id, r.label])) };
const TONE: Record<string, string> = { owner: "#c9482b", manager: "#315e9e", waiter: "#237a68", kitchen: "#a74608", cashier: "#8a5a00", host: "#6d5bd0", accountant: "#64748b" };
const field = "h-11 rounded-xl";

function Avatar({ name, role }: { name: string; role: string }) {
  const c = TONE[role] ?? "#64748b";
  return <span className="grid size-11 shrink-0 place-items-center rounded-full font-display text-lg font-bold" style={{ background: `color-mix(in srgb, ${c} 16%, var(--surface))`, color: c }}>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

function copy(text: string) {
  try { void navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked; the details stay on screen */ }
}

export function TeamScreen({ initial, canEdit, outletCode, outletName, roles: allowed, duty = [], canChangeDuty = false }: { initial: TeamMember[]; canEdit: boolean; outletCode: string; outletName: string; duty?: DutyRow[]; canChangeDuty?: boolean; roles: readonly string[] }) {
  const router = useRouter();
  // Only the roles this restaurant's plan allows (Kitchen comes with the kitchen screen)
  const ROLES = ALL_ROLES.filter((r) => allowed.includes(r.id));
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [manage, setManage] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [created, setCreated] = useState<{ name: string; phone: string; pin: string; role: string; existing: boolean } | null>(null);
  const [q, setQ] = useState("");

  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [role, setRole] = useState<string>("waiter"); const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");

  const member = initial.find((m) => m.id === manage) ?? null;
  const shown = initial.filter((m) => !q.trim() || `${m.name} ${m.phone}`.toLowerCase().includes(q.trim().toLowerCase()));
  const active = initial.filter((m) => m.isActive).length;
  const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));

  const openAdd = () => { setName(""); setPhone(""); setRole("waiter"); setPin(randomPin()); setErr(null); setCreated(null); setAdding(true); };
  const done = (text: string) => { setNotice({ ok: true, text }); router.refresh(); };

  function add() {
    setErr(null);
    start(async () => {
      const res = await addMemberAction({ name, phone, role, pin });
      if (!res.ok) return setErr(res.message);
      setCreated({ name: name.trim(), phone: phone.replace(/\D/g, "").slice(-10), pin, role, existing: res.data.existing });
      router.refresh();
    });
  }
  function act(fn: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>, ok: string, closeAfter = false) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setErr(res.message);
      done(ok); setNewPin("");
      if (closeAfter) setManage(null);
    });
  }

  const loginText = (c: NonNullable<typeof created>) => `${outletName} (TableQR)\nSign in at /console/login\nOutlet code: ${outletCode}\nPhone: ${c.phone}\n${c.existing ? "PIN: your existing PIN" : `PIN: ${c.pin}`}`;
  const roleInfo = ROLES.find((r) => r.id === role);

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">{outletName}</p>
          <h1 className="mt-1 font-display text-title font-bold text-ink">Team</h1>
          <p className="mt-1 text-body text-muted">People who can sign in here. {canEdit ? "Add your managers, waiters and accountants." : "Only the owner can change the team."}</p>
        </div>
        {canEdit && <button type="button" onClick={openAdd} className="inline-flex h-11 items-center gap-2 rounded-xl border border-brand bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"><Plus className="size-4" aria-hidden="true" />Add person</button>}
      </header>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
        {[["People", initial.length], ["Active", active], ["Switched off", initial.length - active]].map(([k, v]) => <div key={k as string} className="rounded-2xl border border-line bg-surface p-3"><p className="font-display text-title font-bold tabular-nums">{v}</p><p className="text-caption text-muted">{k}</p></div>)}
      </div>

      <WhoIsWorking rows={duty} canChange={canChangeDuty} />

      <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold">How your team signs in</p>
        <p className="mt-1 text-sm text-muted">Open <b className="text-ink">/console/login</b>, type the outlet code <b className="font-mono text-ink">{outletCode}</b>, their phone number and 4-digit PIN. Each role lands on its own screen automatically.</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {ROLES.map((r) => <span key={r.id} className="rounded-full bg-ink/5 px-2.5 py-1 font-semibold">{r.label} → {r.opens}</span>)}
        </div>
      </section>

      {notice && <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-success/30 bg-surface px-3 py-2 text-sm font-semibold text-success"><Check className="size-4" aria-hidden="true" />{notice.text}</p>}

      <div className="mt-4"><Input aria-label="Search team" className={`${field} max-w-sm`} placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} /></div>

      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {shown.map((m) => (
          <li key={m.id} className={`flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 ${m.isActive ? "" : "opacity-60"}`}>
            <Avatar name={m.name} role={m.roles[0]} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{m.name}{m.isMe && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</p>
              <p className="flex items-center gap-1 truncate text-caption text-muted"><Phone className="size-3" aria-hidden="true" />{m.phone}</p>
              <p className="mt-1 flex flex-wrap gap-1.5">{m.roles.map((r) => <span key={r} className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `color-mix(in srgb, ${TONE[r] ?? "#64748b"} 14%, var(--surface))`, color: TONE[r] ?? "#64748b" }}>{LABEL[r] ?? r}</span>)}{!m.isActive && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-muted">Switched off</span>}</p>
            </div>
            {canEdit && !m.locked && !m.isMe && <button type="button" onClick={() => { setManage(m.id); setErr(null); setNewPin(randomPin()); }} className="min-h-10 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold hover:border-ink/40">Manage</button>}
          </li>
        ))}
        {shown.length === 0 && <li className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center text-sm text-muted sm:col-span-2"><UserRound className="mx-auto mb-2 size-6" aria-hidden="true" />No one found.</li>}
      </ul>

      <Sheet open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-md">
          <SheetHeader><SheetTitle className="font-display text-title font-bold">{created ? "Person added" : "Add a person"}</SheetTitle><SheetDescription>{created ? "Share these sign-in details with them." : "They sign in with their phone number and a 4-digit PIN."}</SheetDescription></SheetHeader>
          <div className="space-y-5 px-4 pb-8">
            {created ? (
              <>
                <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
                  <p className="font-display text-section font-bold">{created.name} · {LABEL[created.role]}</p>
                  <dl className="mt-3 space-y-1.5">
                    <div className="flex justify-between"><dt className="text-muted">Sign in at</dt><dd className="font-semibold">/console/login</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Outlet code</dt><dd className="font-mono font-semibold">{outletCode}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Phone</dt><dd className="font-mono font-semibold">{created.phone}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">PIN</dt><dd className="font-mono font-semibold">{created.existing ? "Their existing PIN" : created.pin}</dd></div>
                  </dl>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => copy(loginText(created))} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold hover:border-ink/40"><Copy className="size-4" aria-hidden="true" />Copy details</button>
                  <button type="button" onClick={() => setAdding(false)} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-brand bg-brand text-sm font-semibold text-white hover:bg-brand-strong">Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5"><Label htmlFor="t-name">Name</Label><Input id="t-name" className={field} placeholder="e.g. Rahul" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="t-phone">Mobile number</Label><Input id="t-phone" className={`${field} font-mono`} inputMode="numeric" maxLength={14} placeholder="10 digits" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ""))} /></div>
                <div className="space-y-2"><Label>Role</Label>
                  <div className="grid grid-cols-2 gap-2">{ROLES.map((r) => <button key={r.id} type="button" aria-pressed={role === r.id} onClick={() => setRole(r.id)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${role === r.id ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}>{r.label}</button>)}</div>
                  {roleInfo && <p className="text-xs text-muted">{roleInfo.does}. Opens the {roleInfo.opens}.</p>}
                </div>
                <div className="space-y-1.5"><Label htmlFor="t-pin">4-digit PIN</Label>
                  <div className="flex gap-2"><Input id="t-pin" className={`${field} font-mono tracking-[0.4em]`} inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /><button type="button" onClick={() => setPin(randomPin())} className="min-h-11 shrink-0 rounded-xl border border-line px-3 text-sm font-semibold hover:border-ink/40">New PIN</button></div>
                  <p className="text-xs text-muted">If this number already works with you, their old PIN stays.</p>
                </div>
                {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
                <button type="button" disabled={pending || name.trim().length < 2 || phone.replace(/\D/g, "").length < 10 || pin.length !== 4} onClick={add} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{pending ? "Adding…" : "Add person"}</button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!member} onOpenChange={(o) => !o && setManage(null)}>
        <SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-md">
          {member && (
            <>
              <SheetHeader><SheetTitle className="font-display text-title font-bold">{member.name}</SheetTitle><SheetDescription>{member.phone} · {member.roles.map((r) => LABEL[r] ?? r).join(", ")}</SheetDescription></SheetHeader>
              <div className="space-y-6 px-4 pb-8">
                <section className="space-y-2"><p className="text-sm font-semibold">Role</p>
                  <div className="grid grid-cols-2 gap-2">{ROLES.map((r) => <button key={r.id} type="button" disabled={pending} aria-pressed={member.roles[0] === r.id} onClick={() => member.roles[0] !== r.id && act(() => changeRoleAction(member.id, r.id), `${member.name} is now ${r.label}.`)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${member.roles[0] === r.id ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}>{r.label}</button>)}</div>
                </section>
                <section className="space-y-2"><p className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="size-4" aria-hidden="true" />Reset PIN</p>
                  <div className="flex gap-2"><Input aria-label="New PIN" className={`${field} font-mono tracking-[0.4em]`} inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} /><button type="button" disabled={pending || newPin.length !== 4} onClick={() => act(() => resetPinAction(member.id, newPin), `New PIN set for ${member.name}. They are signed out.`)} className="min-h-11 shrink-0 rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/40 disabled:opacity-50">Set PIN</button></div>
                  <p className="text-xs text-muted">They are signed out everywhere and must use the new PIN.</p>
                </section>
                <section className="space-y-2"><p className="flex items-center gap-1.5 text-sm font-semibold"><Power className="size-4" aria-hidden="true" />Access</p>
                  <p className="text-xs text-muted">{member.isActive ? "Switch off when someone leaves. They are signed out at once. You can switch them on again later." : "This person cannot sign in now."}</p>
                  <button type="button" disabled={pending} onClick={() => act(() => setActiveAction(member.id, !member.isActive), member.isActive ? `${member.name} is switched off.` : `${member.name} can sign in again.`, true)} className={`inline-flex h-12 w-full items-center justify-center rounded-xl border text-sm font-semibold ${member.isActive ? "border-danger/40 text-danger hover:bg-[var(--state-seated-soft)]" : "border-brand bg-brand text-white hover:bg-brand-strong"}`}>{member.isActive ? "Switch off access" : "Switch on access"}</button>
                </section>
                {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
