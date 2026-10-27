"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, MessageCircle, Phone, Plus, Power, Search, Settings2, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { TeamMember } from "@/server/staff/team";
import type { PendingStaffInvitation } from "@/server/staff/invitations";
import type { DutyRow } from "@/server/staff/duty";
import { WhoIsWorking } from "./who-is-working";
import { changeRoleAction, createInvitationAction, resetPinAction, reviewRiderAction, revokeInvitationAction, riderVerificationAction, setActiveAction, setPhotoAction } from "../actions";
import type { RiderVerification } from "@/server/delivery/rider-docs";

const ALL_ROLES = [
  { id: "manager", label: "Manager", does: "Runs the outlet: floor, menu, billing, reports, approvals", opens: "Dashboard", path: "/console/dashboard" },
  { id: "reception", label: "Reception", does: "Hotel front desk: checks guests in and out, room requests and room bills", opens: "Rooms", path: "/console/rooms" },
  { id: "waiter", label: "Waiter", does: "Takes orders at tables, serves, requests the bill", opens: "Waiter app", path: "/waiter" },
  { id: "accountant", label: "Accountant", does: "Takes payments, views bills and reports", opens: "Billing", path: "/pos" },
  { id: "kitchen", label: "Kitchen", does: "Sees orders and marks food ready. Signs in on the kitchen screen with this phone and PIN", opens: "Kitchen", path: "/console/kitchen" },
  { id: "rider", label: "Rider", does: "Delivers home orders: sees only the deliveries given to them, calls the customer, collects cash", opens: "Rider app", path: "/rider" },
] as const;
// Older roles still shown on people who have them
const LABEL: Record<string, string> = { owner: "Owner", cashier: "Cashier", host: "Host", ...Object.fromEntries(ALL_ROLES.map((r) => [r.id, r.label])) };
const TONE: Record<string, string> = { owner: "#c9482b", manager: "#315e9e", waiter: "#237a68", kitchen: "#a74608", cashier: "#8a5a00", host: "#6d5bd0", accountant: "#64748b", reception: "#0f766e" };
const field = "h-11 rounded-xl";

// Shift status from the duty list; people without one (the owner) just show whether they can sign in
const DUTY = {
  on: ["On duty", "bg-[var(--state-available-soft)] text-[var(--state-available-text)]"],
  break: ["On break", "bg-[var(--state-held-soft)] text-[var(--state-held-text)]"],
  off: ["Off duty", "bg-ink/10 text-muted"],
} as const;

function Avatar({ name, role, online = false, photoUrl = null }: { name: string; role: string; online?: boolean; photoUrl?: string | null }) {
  const c = TONE[role] ?? "#64748b";
  return (
    <span className="relative grid size-10 shrink-0 place-items-center rounded-full font-display text-base font-bold" style={{ background: `color-mix(in srgb, ${c} 16%, var(--surface))`, color: c }}>
      {/* Staff photos live in the photo bucket, so this stays a plain image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photoUrl ? <img src={photoUrl} alt="" className="size-10 rounded-full object-cover" /> : name.trim().slice(0, 1).toUpperCase() || "?"}
      {online && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-[var(--state-available)]" title="App open" />}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const c = TONE[role] ?? "#64748b";
  return <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `color-mix(in srgb, ${c} 14%, var(--surface))`, color: c }}>{LABEL[role] ?? role}</span>;
}

function StatusBadge({ member, duty }: { member: TeamMember; duty?: DutyRow }) {
  const [text, tone] = !member.isActive ? ["Switched off", "bg-ink/10 text-muted"] : duty ? DUTY[duty.status] : ["Can sign in", "bg-ink/5 text-muted"];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>;
}

function copy(text: string) {
  try { void navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked; the details stay on screen */ }
}
export function TeamScreen({ initial, invitations: initialInvitations = [], canEdit, outletCode, outletName, roles: allowed, duty = [], canChangeDuty = false }: { initial: TeamMember[]; invitations?: PendingStaffInvitation[]; canEdit: boolean; outletCode: string; outletName: string; duty?: DutyRow[]; canChangeDuty?: boolean; roles: readonly string[] }) {
  const router = useRouter();
  // Only the roles this restaurant's plan allows (Kitchen comes with the kitchen screen)
  const ROLES = ALL_ROLES.filter((r) => allowed.includes(r.id));
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [manage, setManage] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [created, setCreated] = useState<{ phone: string; role: string; inviteUrl: string; expiresAt: number } | null>(null);
  const [q, setQ] = useState("");

  const [phone, setPhone] = useState(""); const [role, setRole] = useState<string>("waiter");
  const [err, setErr] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");

  const member = initial.find((m) => m.id === manage) ?? null;
  const shown = initial.filter((m) => !q.trim() || `${m.name} ${m.phone}`.toLowerCase().includes(q.trim().toLowerCase()));
  const active = initial.filter((m) => m.isActive).length;
  const dutyById = new Map(duty.map((d) => [d.id, d]));
  const openManage = (id: string) => { setManage(id); setErr(null); setNewPin(""); };

  const openAdd = () => { setPhone(""); setRole(ROLES[0]?.id ?? "manager"); setErr(null); setCreated(null); setAdding(true); };
  const done = (text: string) => { setNotice({ ok: true, text }); router.refresh(); };

  function add() {
    setErr(null);
    start(async () => {
      const res = await createInvitationAction({ phone, role });
      if (!res.ok) return setErr(res.message);
      setCreated({ phone: res.data.phone, role: res.data.role, inviteUrl: res.data.inviteUrl, expiresAt: res.data.expiresAt });
      setInvitations((rows) => [ { id: res.data.id, phone: res.data.phone, role: res.data.role, expiresAt: res.data.expiresAt, createdAt: Date.now() }, ...rows ]);
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

  const loginText = (c: NonNullable<typeof created>) => `You're invited to join ${outletName} on TableQR as ${LABEL[c.role] ?? c.role}.\n\nOutlet: ${outletName}\nOutlet code: ${outletCode}\nInvited phone: ${c.phone}\n\nComplete staff setup: ${c.inviteUrl}\nThis link expires in 7 days.`;
  const whatsappUrl = (c: NonNullable<typeof created>) => {
    const digits = c.phone.replace(/\D/g, "");
    return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(loginText(c))}`;
  };
  const roleInfo = ROLES.find((r) => r.id === role);

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">{outletName}</p>
          <h1 className="mt-1 font-display text-title font-bold text-ink">Team</h1>
          <p className="mt-1 text-body text-muted">{canEdit ? "Manage staff access, roles and shifts in one place." : "People who can sign in to this outlet."}</p>
        </div>
        {canEdit && <button type="button" onClick={openAdd} className="inline-flex h-11 items-center gap-2 rounded-xl border border-brand bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"><Plus className="size-4" aria-hidden="true" />Add person</button>}
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {([["People", initial.length, null], ["Can sign in", active, "var(--state-available)"], ["Switched off", initial.length - active, null]] as const).map(([k, v, dot]) => (
          <div key={k} className={`rounded-2xl border border-line bg-surface px-4 py-3 ${k === "Switched off" ? "col-span-2 sm:col-span-1" : ""}`}>
            <p className="flex items-center gap-1.5 text-caption font-medium text-muted">{dot && <span className="size-1.5 rounded-full" style={{ background: dot }} aria-hidden="true" />}{k}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{v}</p>
          </div>
        ))}
      </div>

      {notice && <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-success/30 bg-surface px-3 py-2 text-sm font-semibold text-success"><Check className="size-4" aria-hidden="true" />{notice.text}</p>}

      <section aria-labelledby="team-people" className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div><h2 id="team-people" className="font-display text-section font-bold text-ink">Everyone <span className="ml-1 text-sm font-semibold tabular-nums text-muted">{initial.length}</span></h2><p className="mt-0.5 text-xs text-muted">Select a person to manage their role, PIN or access.</p></div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input aria-label="Search team" className="h-10 rounded-xl pl-9" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-line hover:bg-transparent">
              <TableHead className="h-10 px-4 text-xs font-semibold tracking-wide text-muted uppercase">Person</TableHead>
              <TableHead className="hidden h-10 px-4 text-xs font-semibold tracking-wide text-muted uppercase sm:table-cell">Role</TableHead>
              <TableHead className="hidden h-10 px-4 text-xs font-semibold tracking-wide text-muted uppercase md:table-cell">Status</TableHead>
              <TableHead className="h-10 w-0 px-4"><span className="sr-only">Change</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((m) => {
              const d = dutyById.get(m.id);
              return (
                <TableRow key={m.id} className={`border-line hover:bg-ink/[0.03] ${m.isActive ? "" : "opacity-60"}`}>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="flex items-center gap-3">
                      {canEdit && !m.locked && !m.isMe ? (
                        <button type="button" onClick={() => openManage(m.id)} aria-label={`Manage ${m.name}`} className="group/person flex min-w-0 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-brand">
                          <Avatar name={m.name} role={m.roles[0]} online={d?.online} photoUrl={m.photoUrl} />
                          <span className="min-w-0"><span className="block truncate font-semibold text-ink group-hover/person:text-brand">{m.name}<span className="ml-1.5 text-xs font-normal text-muted">(Manage)</span></span><span className="flex items-center gap-1 truncate text-caption text-muted"><Phone className="size-3" aria-hidden="true" />{m.phone}</span><span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">{m.roles.map((r) => <RoleBadge key={r} role={r} />)}<StatusBadge member={m} duty={d} /></span></span>
                        </button>
                      ) : (
                        <div className="flex min-w-0 items-center gap-3"><Avatar name={m.name} role={m.roles[0]} online={d?.online} photoUrl={m.photoUrl} /><div className="min-w-0"><p className="truncate font-semibold text-ink">{m.name}{m.isMe && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</p><p className="flex items-center gap-1 truncate text-caption text-muted"><Phone className="size-3" aria-hidden="true" />{m.phone}</p><p className="mt-1 flex flex-wrap gap-1.5 sm:hidden">{m.roles.map((r) => <RoleBadge key={r} role={r} />)}<StatusBadge member={m} duty={d} /></p></div></div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 sm:table-cell">
                    <div className="flex flex-wrap gap-1.5">{m.roles.map((r) => <RoleBadge key={r} role={r} />)}<span className="md:hidden"><StatusBadge member={m} duty={d} /></span></div>
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 md:table-cell"><StatusBadge member={m} duty={d} /></TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    {canEdit && !m.locked && !m.isMe && <button type="button" onClick={() => openManage(m.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold hover:border-ink/40"><Settings2 className="size-3.5" aria-hidden="true" />Manage</button>}
                  </TableCell>
                </TableRow>
              );
            })}
            {shown.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="p-10 text-center text-sm text-muted"><UserRound className="mx-auto mb-2 size-6" aria-hidden="true" />No one found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <WhoIsWorking rows={duty} canChange={canChangeDuty} onSelect={canEdit ? openManage : undefined} />

      {canEdit && invitations.length > 0 && <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><h2 className="font-display text-section font-bold text-ink">Pending invitations <span className="ml-1 text-sm text-muted">{invitations.length}</span></h2><p className="mt-1 text-sm text-muted">Staff access starts after they verify their invited phone number.</p><div className="mt-3 divide-y divide-line">{invitations.map((invite) => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold text-ink">{invite.phone} · {LABEL[invite.role] ?? invite.role}</p><p className="text-xs text-muted">Expires {new Date(invite.expiresAt).toLocaleDateString()}</p></div><button type="button" disabled={pending} onClick={() => start(async () => { const res = await revokeInvitationAction(invite.id); if (!res.ok) return setNotice({ ok: false, text: res.message }); setInvitations((rows) => rows.filter((row) => row.id !== invite.id)); setNotice({ ok: true, text: "Invitation revoked." }); router.refresh(); })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold hover:border-danger/50 hover:text-danger"><X className="size-4" aria-hidden="true" />Revoke</button></div>)}</div></section>}

      <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold">How your team signs in</p>
        <p className="mt-1 text-sm text-muted">Open <b className="text-ink">/console/login</b>, type the outlet code <b className="font-mono text-ink">{outletCode}</b>, their phone number and 4-digit PIN. Each role lands on its own screen automatically.</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {ROLES.map((r) => <span key={r.id} className="rounded-full bg-ink/5 px-2.5 py-1 font-semibold">{r.label} → {r.opens}</span>)}
        </div>
      </section>

      <Sheet open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-md">
          <SheetHeader><SheetTitle className="font-display text-title font-bold">{created ? "Invitation ready" : "Invite a person"}</SheetTitle><SheetDescription>{created ? "They must verify this phone before their staff access starts." : "Choose a role and send an invitation to their phone. They will add their name and create a PIN after OTP verification."}</SheetDescription></SheetHeader>
          <div className="space-y-5 px-4 pb-8">
            {created ? (
              <>
                <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
                  <p className="font-display text-section font-bold">{created.phone} · {LABEL[created.role]}</p>
                  <dl className="mt-3 space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-muted">Outlet</dt><dd className="text-right font-semibold">{outletName}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Outlet code</dt><dd className="font-mono font-semibold">{outletCode}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Phone</dt><dd className="font-mono font-semibold">{created.phone}</dd></div>
                    <div className="mt-2 break-all rounded-lg bg-ink/5 p-2 font-mono text-xs">{created.inviteUrl}</div>
                    <p className="mt-2 text-xs text-muted">Link expires {new Date(created.expiresAt).toLocaleString()}.</p>
                  </dl>
                </div>
                <a href={whatsappUrl(created)} target="_blank" rel="noreferrer noopener" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#1f8f4e] bg-[#1f8f4e] text-sm font-semibold text-white hover:bg-[#1a7a43]"><MessageCircle className="size-4" aria-hidden="true" />Send on WhatsApp</a>
                <div className="flex gap-2">
                  <button type="button" onClick={() => copy(loginText(created))} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold hover:border-ink/40"><Copy className="size-4" aria-hidden="true" />Copy invite</button>
                  <button type="button" onClick={() => setAdding(false)} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-brand bg-brand text-sm font-semibold text-white hover:bg-brand-strong">Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5"><Label htmlFor="t-phone">Mobile number</Label><Input id="t-phone" className={`${field} font-mono`} inputMode="numeric" maxLength={14} placeholder="10 digits" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ""))} /></div>
                <div className="space-y-2"><Label>Role</Label>
                  <div className="grid grid-cols-2 gap-2">{ROLES.map((r) => <button key={r.id} type="button" aria-pressed={role === r.id} onClick={() => setRole(r.id)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${role === r.id ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}>{r.label}</button>)}</div>
                  {roleInfo && <p className="text-xs text-muted">{roleInfo.does}. Opens the {roleInfo.opens}.</p>}
                </div>
                {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
                <button type="button" disabled={pending || phone.replace(/\D/g, "").length < 10} onClick={add} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{pending ? "Creating…" : "Create invitation"}</button>
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
                {member.roles.includes("rider") && <RiderCheck key={member.id} userId={member.id} name={member.name} />}
                <section className="space-y-2"><p className="text-sm font-semibold">Photo</p>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line px-3 text-sm font-semibold hover:border-ink/40">
                    <Avatar name={member.name} role={member.roles[0]} photoUrl={member.photoUrl} />
                    {member.photoUrl ? "Change photo" : "Add a photo"}<span className="ml-auto text-xs font-normal text-muted">Shown on the dashboard{member.roles.includes("rider") ? " and to customers" : ""}</span>
                    <input type="file" accept="image/*" className="sr-only" disabled={pending} onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.set("photo", file); act(() => setPhotoAction(member.id, fd), `Photo saved for ${member.name}.`); }} />
                  </label>
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

/** Owner or manager checks a rider's Aadhaar photos and verifies or rejects them */
function RiderCheck({ userId, name }: { userId: string; name: string }) {
  const [v, setV] = useState<RiderVerification | null>(null);
  const [note, setNote] = useState("");
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void riderVerificationAction(userId).then((r) => (r.ok ? setV(r.data) : setError(r.message))); }, [userId]);
  const decide = (decision: "verified" | "rejected") => { setBusy(true); setError(null); void reviewRiderAction(userId, decision, note, keep).then((r) => { setBusy(false); if (r.ok) setV(r.data); else setError(r.message); }); };
  return (
    <section className="space-y-2 rounded-xl border border-line p-3">
      <p className="text-sm font-semibold">Rider verification</p>
      {!v ? <p className="text-xs text-muted">{error ?? "Loading…"}</p>
        : v.status === "verified" ? <p className="text-sm font-semibold text-[var(--state-available-text)]">Verified · Aadhaar ending {v.last4}. Customers see a verified badge.</p>
        : v.status === "none" ? <p className="text-xs text-muted">{name} has not sent documents yet. They do it from the rider app.</p>
        : v.status === "rejected" ? <p className="text-xs text-muted">Sent back: {v.note}. Waiting for {name} to send again.</p>
        : <>
          <p className="text-xs text-muted">Aadhaar ending <b className="text-ink">{v.last4}</b>. Check the photos match their face photo and name.</p>
          {v.hasDocs && <div className="grid grid-cols-2 gap-2">
            {(["front", "back"] as const).map((side) => (
              <a key={side} href={`/console/team/rider-doc/${userId}/${side}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line">
                {/* Decrypted by the server for owners and managers only */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/console/team/rider-doc/${userId}/${side}`} alt={`Aadhaar ${side}`} className="aspect-[3/2] w-full object-cover" />
              </a>
            ))}
          </div>}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="If rejecting: what to fix (e.g. photo blurry)" className="min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm" />
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep the photos after verifying (normally deleted)</label>
          {error && <p role="alert" className="text-xs font-semibold text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => decide("verified")} className="min-h-10 flex-1 rounded-lg bg-[var(--state-available)] text-sm font-semibold text-white disabled:opacity-60">Verify</button>
            <button type="button" disabled={busy || note.trim().length < 3} onClick={() => decide("rejected")} className="min-h-10 flex-1 rounded-lg border border-danger/50 text-sm font-semibold text-danger disabled:opacity-50">Reject</button>
          </div>
        </>}
    </section>
  );
}
