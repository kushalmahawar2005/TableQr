"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Copy, KeyRound, MessageCircle, Plus, Power, Search, TriangleAlert, UserCheck, UserRound, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { TeamMember } from "@/server/staff/team";
import type { PendingStaffInvitation } from "@/server/staff/invitations";
import type { DutyRow } from "@/server/staff/duty";
import { WhoIsWorking } from "./who-is-working";
import { columnHead, DetailHead, DetailSection, DetailSheet, Pill, primaryButton, QueuePanel, RowSelect, rowCells, rowTone, secondaryButton, Segmented, StatCards } from "../../orders/_components/orders-ui";
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
// Person, role, login access, duty, action; the rows stack on phones
const COLUMNS = "lg:grid-cols-[minmax(0,1.4fr)_76px_96px_84px_72px]";
const field = "h-11 rounded-xl";

// Shift status from the duty list; people without one (the owner) just show whether they can sign in
const DUTY = {
  on: ["On duty", "bg-[var(--state-available-soft)] text-[var(--state-available-text)]"],
  break: ["On break", "bg-[var(--state-held-soft)] text-[var(--state-held-text)]"],
  off: ["Off duty", "bg-ink/10 text-muted"],
} as const;
const ENABLED = "bg-[var(--state-available-soft)] text-[var(--state-available-text)]";
const PENDING = "bg-[var(--state-held-soft)] text-[var(--state-held-text)]";
const FIELD = "h-10 rounded-input border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[var(--state-available)]";
const OWNER_ROLE = { label: "Owner", does: "Full control of the outlet, team, plan and settings", opens: "Dashboard" };

function Avatar({ name, online = false, photoUrl = null }: { name: string; online?: boolean; photoUrl?: string | null }) {
  return (
    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-sage font-display text-base font-bold text-forest">
      {/* Staff photos live in the photo bucket, so this stays a plain image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photoUrl ? <img src={photoUrl} alt="" className="size-10 rounded-full object-cover" /> : name.trim().slice(0, 1).toUpperCase() || "?"}
      {online && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-[var(--state-available)]" title="App open" />}
    </span>
  );
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
  const [view, setView] = useState<"all" | "duty" | "pending" | "off">("all");
  const [roleFilter, setRoleFilter] = useState("all");
  // Chosen on purpose: opens the person on phones. Wide screens show the first person until then.
  const [picked, setPicked] = useState<string | null>(null);

  const [phone, setPhone] = useState(""); const [role, setRole] = useState<string>("waiter");
  const [err, setErr] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");

  const member = initial.find((m) => m.id === manage) ?? null;
  const active = initial.filter((m) => m.isActive).length;
  const dutyById = new Map(duty.map((d) => [d.id, d]));
  const needle = q.trim().toLowerCase();
  const onDuty = duty.filter((d) => d.status === "on");
  const roleOk = (roles: readonly string[]) => roleFilter === "all" || roles.includes(roleFilter);
  const shown = initial.filter((m) => (!needle || `${m.name} ${m.phone}`.toLowerCase().includes(needle)) && roleOk(m.roles) && (view === "all" || (view === "duty" && dutyById.get(m.id)?.status === "on") || (view === "off" && !m.isActive)));
  const shownInvites = !canEdit || view === "duty" || view === "off" ? [] : invitations.filter((i) => (!needle || i.phone.toLowerCase().includes(needle)) && roleOk([i.role]));
  const peopleShown = view === "pending" ? [] : shown;
  const focus = peopleShown.find((m) => m.id === picked) ?? peopleShown[0] ?? null;
  const focusRole = focus ? (focus.roles[0] === "owner" ? OWNER_ROLE : ALL_ROLES.find((r) => r.id === focus.roles[0])) : null;
  const roleChoices = [...new Set([...initial.flatMap((m) => m.roles), ...invitations.map((i) => i.role)])];
  const signInText = `Open /console/login, enter outlet code ${outletCode}, the staff phone number and a 4-digit PIN. Each role lands on its own screen.`;
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

  const loginText = (c: NonNullable<typeof created>) => `You're invited to join ${outletName} on Tableeqr as ${LABEL[c.role] ?? c.role}.\n\nOutlet: ${outletName}\nOutlet code: ${outletCode}\nInvited phone: ${c.phone}\n\nComplete staff setup: ${c.inviteUrl}\nThis link expires in 7 days.`;
  const whatsappUrl = (c: NonNullable<typeof created>) => {
    const digits = c.phone.replace(/\D/g, "");
    return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(loginText(c))}`;
  };
  const roleInfo = ROLES.find((r) => r.id === role);

  return (
    <div className="dashboard-theme min-h-[calc(100dvh-4rem)] bg-dashboard-canvas sm:min-h-[calc(100dvh-4.5rem)]">
    <main className="mx-auto w-full max-w-[1440px] px-3 py-3 pb-6 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold leading-6 tracking-tight text-ink sm:text-[28px] sm:leading-8">Team &amp; access</h1>
          <p className="mt-1 text-sm font-medium text-muted">{canEdit ? "See who can sign in, their role, and who is working now." : "People who can sign in to this outlet."}</p>
        </div>
        {canEdit && <button type="button" onClick={openAdd} className={primaryButton}><Plus className="size-4" aria-hidden="true" />Add person</button>}
      </header>

      <StatCards stats={[
        { icon: Users, label: "People", value: String(initial.length), note: "On this team" },
        { icon: UserCheck, label: "Can sign in", value: String(active), note: "Login is on" },
        { icon: Clock, label: "On duty", value: String(onDuty.length), note: `${onDuty.filter((d) => d.online).length} with the app open` },
        { icon: TriangleAlert, label: "Needs a look", value: String(invitations.length + initial.length - active), note: `${invitations.length} invited · ${initial.length - active} switched off`, tone: "accent" },
      ]} />

      {notice && <p role={notice.ok ? "status" : "alert"} className={`mt-4 flex items-center gap-2 rounded-input border bg-surface px-3 py-2 text-sm font-semibold ${notice.ok ? "border-success/30 text-success" : "border-danger/40 text-danger"}`}><Check className="size-4" aria-hidden="true" />{notice.text}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
        <Segmented label="Show people" value={view} onChange={setView} options={[{ key: "all", label: "Everyone", count: initial.length + (canEdit ? invitations.length : 0) }, { key: "duty", label: "On duty", count: onDuty.length }, ...(canEdit ? [{ key: "pending" as const, label: "Pending", count: invitations.length }] : []), { key: "off", label: "Switched off", count: initial.length - active }]} />
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input aria-label="Search team" className={`${FIELD} w-full pl-9`} placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select aria-label="Role" className={`${FIELD} font-semibold`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="all">All roles</option>{roleChoices.map((r) => <option key={r} value={r}>{LABEL[r] ?? r}</option>)}</select>
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <QueuePanel title="Everyone" meta={`${peopleShown.length + shownInvites.length} of ${initial.length + (canEdit ? invitations.length : 0)}`} columns={peopleShown.length + shownInvites.length > 0 && <div className={`${columnHead} ${COLUMNS}`}><span>Person</span><span>Role</span><span>Login access</span><span>Duty</span><span className="text-right">Action</span></div>}>
            {peopleShown.length + shownInvites.length === 0 ? <p className="p-10 text-center text-sm text-muted"><UserRound className="mx-auto mb-2 size-6" aria-hidden="true" />No one found.</p> : <ul>
              {peopleShown.map((m) => {
                const d = dutyById.get(m.id);
                const editable = canEdit && !m.locked && !m.isMe;
                const sel = focus?.id === m.id;
                const [dutyText, dutyTone] = d ? DUTY[d.status] : ["—", "text-muted"];
                return (
                  <li key={m.id} className={`${rowCells} ${COLUMNS} ${rowTone(sel, false)}`}>
                    <span className="col-start-1 row-start-1 min-w-0 lg:col-auto lg:row-auto">
                      <RowSelect selected={sel} onSelect={() => setPicked(m.id)}>
                        <span className={`flex min-w-0 items-center gap-3 ${m.isActive ? "" : "opacity-60"}`}>
                          <Avatar name={m.name} online={d?.online} photoUrl={m.photoUrl} />
                          <span className="min-w-0"><span className="block truncate text-sm font-bold text-ink">{m.name}</span><span className="block truncate text-xs font-medium text-muted tabular-nums">{m.phone}</span></span>
                        </span>
                      </RowSelect>
                    </span>
                    <span className="col-start-1 row-start-2 mt-1.5 truncate text-sm text-ink lg:col-auto lg:row-auto lg:mt-0">{m.roles.map((r) => LABEL[r] ?? r).join(", ")}</span>
                    <span className="col-start-2 row-start-1 justify-self-end lg:col-auto lg:row-auto lg:justify-self-start"><Pill className={m.isActive ? ENABLED : "bg-ink/10 text-muted"}>{m.isActive ? "Enabled" : "Switched off"}</Pill></span>
                    <span className="col-start-2 row-start-2 mt-1.5 justify-self-end lg:col-auto lg:row-auto lg:mt-0 lg:justify-self-start">{d ? <Pill className={dutyTone}>{dutyText}</Pill> : <span className="text-sm text-muted">—</span>}</span>
                    <span className="relative z-10 hidden justify-end lg:flex">{editable ? <button type="button" aria-label={`Manage ${m.name}`} onClick={() => openManage(m.id)} className={`${secondaryButton} !min-h-9 !px-3 text-xs`}>Manage</button> : <span className="text-xs text-muted">{m.isMe ? "You" : "Protected"}</span>}</span>
                  </li>
                );
              })}
              {shownInvites.map((invite) => (
                <li key={invite.id} className={`${rowCells} ${COLUMNS} border-l-transparent`}>
                  <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 lg:col-auto lg:row-auto"><Avatar name="?" /><span className="min-w-0"><span className="block truncate text-sm font-bold text-ink tabular-nums">{invite.phone}</span><span className="block truncate text-xs font-medium text-muted">Expires {new Date(invite.expiresAt).toLocaleDateString("en-IN")}</span></span></span>
                  <span className="col-start-1 row-start-2 mt-1.5 truncate text-sm text-ink lg:col-auto lg:row-auto lg:mt-0">{LABEL[invite.role] ?? invite.role}</span>
                  <span className="col-start-2 row-start-1 justify-self-end lg:col-auto lg:row-auto lg:justify-self-start"><Pill className={PENDING}>Invited</Pill></span>
                  <span className="hidden text-sm text-muted lg:inline">—</span>
                  <span className="col-start-2 row-start-2 mt-1.5 flex justify-end lg:col-auto lg:row-auto lg:mt-0"><button type="button" disabled={pending} onClick={() => start(async () => { const res = await revokeInvitationAction(invite.id); if (!res.ok) return setNotice({ ok: false, text: res.message }); setInvitations((rows) => rows.filter((row) => row.id !== invite.id)); setNotice({ ok: true, text: "Invitation revoked." }); router.refresh(); })} className={`${secondaryButton} !min-h-9 !px-3 text-xs hover:border-danger/50 hover:text-danger`}>Revoke</button></span>
                </li>
              ))}
            </ul>}
          </QueuePanel>

          <WhoIsWorking rows={duty} canChange={canChangeDuty} onSelect={canEdit ? openManage : undefined} />
        </div>

        <div className="min-w-0 space-y-4">
          {focus && <DetailSheet label="Person details" open={picked === focus.id}>
            <DetailHead title={focus.name} badge={<Pill className="bg-surface/70 text-forest">{focus.roles.map((r) => LABEL[r] ?? r).join(", ")}</Pill>} sub={focus.phone} onClose={() => setPicked(null)} />
            <DetailSection>
              <div className="flex flex-wrap gap-1.5"><Pill className={focus.isActive ? ENABLED : "bg-ink/10 text-muted"}>{focus.isActive ? "Enabled" : "Switched off"}</Pill>{dutyById.get(focus.id) && <Pill className={DUTY[dutyById.get(focus.id)!.status][1]}>{DUTY[dutyById.get(focus.id)!.status][0]}</Pill>}</div>
            </DetailSection>
            {focusRole && <DetailSection title="What this role does">
              <p className="text-sm text-ink">{focusRole.does}.</p>
              <p className="mt-1 text-xs text-muted">Opens {focusRole.opens} after sign in.</p>
            </DetailSection>}
            <DetailSection>
              {canEdit && !focus.locked && !focus.isMe ? <>
                <button type="button" onClick={() => { setPicked(null); openManage(focus.id); }} className={`w-full ${primaryButton}`}>Manage role, PIN and access</button>
                <p className="mt-2 text-xs text-muted">PINs are never shown. A reset signs them out everywhere.</p>
              </> : <p className="text-sm text-muted">{focus.isMe ? "This is your own account." : "This account is protected."}</p>}
            </DetailSection>
          </DetailSheet>}

          <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="font-display text-[15px] font-bold text-ink">How your team signs in</h2><button type="button" onClick={() => { copy(signInText); setNotice({ ok: true, text: "Sign-in steps copied." }); }} className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold text-forest hover:underline"><Copy className="size-3.5" aria-hidden="true" />Copy</button></div>
            <p className="mt-1 text-sm text-muted">Open <b className="text-ink">/console/login</b>, enter outlet code <b className="font-mono text-ink">{outletCode}</b>, their phone number and 4-digit PIN.</p>
          </section>
        </div>
      </div>

      <Sheet open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-md">
          <SheetHeader className="gap-0.5 py-3"><SheetTitle className="font-display text-section font-bold">{created ? "Invitation ready" : "Invite a person"}</SheetTitle><SheetDescription className="max-w-[38ch] text-xs leading-relaxed">{created ? "They must verify this phone before their staff access starts." : "Choose a role and send an invitation. They will add their name and PIN after phone verification."}</SheetDescription></SheetHeader>
          <div className="space-y-4 px-4 pb-6">
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
                  <button type="button" onClick={() => setAdding(false)} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-forest bg-forest text-sm font-semibold text-white hover:bg-forest-hover">Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1"><Label className="text-xs" htmlFor="t-phone">Mobile number</Label><Input id="t-phone" className="h-10 rounded-lg font-mono" inputMode="numeric" maxLength={14} placeholder="10 digits" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ""))} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Role</Label>
                  <div className="grid grid-cols-2 gap-1.5">{ROLES.map((r) => <button key={r.id} type="button" aria-pressed={role === r.id} onClick={() => setRole(r.id)} className={`min-h-10 rounded-lg border px-2.5 text-sm font-semibold ${role === r.id ? "border-forest bg-forest text-white" : "border-line hover:border-ink/40"}`}>{r.label}</button>)}</div>
                  {roleInfo && <p className="text-xs leading-snug text-muted">{roleInfo.does}. Opens the {roleInfo.opens}.</p>}
                </div>
                {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
                <button type="button" disabled={pending || phone.replace(/\D/g, "").length < 10} onClick={add} className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-forest bg-forest text-sm font-semibold text-white hover:bg-forest-hover disabled:opacity-50">{pending ? "Creating…" : "Create invitation"}</button>
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
                  <div className="grid grid-cols-2 gap-2">{ROLES.map((r) => <button key={r.id} type="button" disabled={pending} aria-pressed={member.roles[0] === r.id} onClick={() => member.roles[0] !== r.id && act(() => changeRoleAction(member.id, r.id), `${member.name} is now ${r.label}.`)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${member.roles[0] === r.id ? "border-forest bg-forest text-white" : "border-line hover:border-ink/40"}`}>{r.label}</button>)}</div>
                </section>
                {member.roles.includes("rider") && <RiderCheck key={member.id} userId={member.id} name={member.name} />}
                <section className="space-y-2"><p className="text-sm font-semibold">Photo</p>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line px-3 text-sm font-semibold hover:border-ink/40">
                    <Avatar name={member.name} photoUrl={member.photoUrl} />
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
                  <button type="button" disabled={pending} onClick={() => act(() => setActiveAction(member.id, !member.isActive), member.isActive ? `${member.name} is switched off.` : `${member.name} can sign in again.`, true)} className={`inline-flex h-12 w-full items-center justify-center rounded-xl border text-sm font-semibold ${member.isActive ? "border-danger/40 text-danger hover:bg-[var(--state-seated-soft)]" : "border-forest bg-forest text-white hover:bg-forest-hover"}`}>{member.isActive ? "Switch off access" : "Switch on access"}</button>
                </section>
                {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </main>
    </div>
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
