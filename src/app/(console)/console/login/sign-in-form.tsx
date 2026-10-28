"use client";

import { useActionState, useState } from "react";
import { signInAction, type SignInState } from "./actions";
import { staffAppLoginRoles, type StaffAppLoginRole } from "@/lib/console-nav";

const field = "mt-1 block h-12 w-full rounded-input border border-line bg-surface px-3 text-section text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20";

const roleCards: { id: string; title: string; description: string; roles: { role: StaffAppLoginRole; title: string; description: string }[] }[] = [
  { id: "owner", title: "Login as Owner", description: "Restaurant overview and settings", roles: [{ role: "owner", title: "Owner", description: "Restaurant overview and settings" }] },
  { id: "manager", title: "Login as Manager", description: "Manager or accountant access", roles: [
    { role: "manager", title: "Manager", description: "Team and daily operations" },
    { role: "accountant", title: "Accountant", description: "Billing and business reports" },
  ] },
  { id: "floor", title: "Login as Host / Cashier", description: "Host, cashier or reception access", roles: [
    { role: "host", title: "Host", description: "Floor, bookings and waitlist" },
    { role: "cashier", title: "Cashier", description: "POS orders and payments" },
    { role: "reception", title: "Reception", description: "Guest rooms and check-in" },
  ] },
  { id: "service", title: "Login as Kitchen / Waiter", description: "Kitchen and table service access", roles: [
    { role: "kitchen", title: "Kitchen staff", description: "Kitchen tickets and order status" },
    { role: "waiter", title: "Waiter", description: "Tables, orders and guest requests" },
  ] },
];

export function SignInForm({ outlet }: { outlet: string }) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<StaffAppLoginRole | null>(null);
  const initialRole = selectedRole ?? "owner";
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, { error: null, outlet, phone: "", role: initialRole });
  const role = selectedRole ?? state.role;
  return (
    <section className="w-full max-w-xl rounded-[1.25rem] border border-line bg-surface p-5 shadow-modal sm:p-7" aria-label="Tableeqr staff sign in">
      <div className="flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-input bg-ink font-display text-section font-bold text-white" aria-hidden="true">T</span>
        <p className="font-display text-section font-bold text-ink">Tableeqr Staff</p>
      </div>
      {!selectedGroup ? (
        <>
          <h1 className="mt-5 font-display text-title font-bold text-ink">How do you use Tableeqr?</h1>
          <p className="mt-1 text-body text-muted">Choose your login to continue. Your account must have the matching access.</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {roleCards.map((card) => (
              <button key={card.id} type="button" onClick={() => { setSelectedGroup(card.id); if (card.roles.length === 1) setSelectedRole(card.roles[0].role); }} className="flex min-h-20 items-center gap-3 rounded-xl border border-line bg-paper p-4 text-left transition-colors hover:border-ink/40 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-white" aria-hidden="true">{card.title.replace("Login as ", "").slice(0, 1)}</span>
                <span className="min-w-0"><span className="block font-semibold text-ink">{card.title}</span><span className="mt-0.5 block text-caption text-muted">{card.description}</span></span>
              </button>
            ))}
          </div>
          <p className="mt-5 text-center text-caption text-muted">Riders use the separate Tableeqr Rider app.</p>
        </>
      ) : !selectedRole ? (
        <div className="mt-5">
          <h1 className="font-display text-title font-bold text-ink">Choose your role</h1>
          <p className="mt-1 text-body text-muted">Select the role assigned to your account.</p>
          <div className="mt-4 grid gap-2">
            {roleCards.find((card) => card.id === selectedGroup)?.roles.filter(({ role: candidate }) => staffAppLoginRoles.includes(candidate)).map((option) => (
              <button key={option.role} type="button" onClick={() => setSelectedRole(option.role)} className="flex min-h-14 items-center justify-between rounded-xl border border-line bg-paper px-4 py-3 text-left transition-colors hover:border-ink/40 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                <span><span className="block font-semibold text-ink">{option.title}</span><span className="block text-caption text-muted">{option.description}</span></span><span aria-hidden="true" className="text-xl text-muted">›</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSelectedGroup(null)} className="mt-3 min-h-10 w-full rounded-input px-3 text-body font-semibold text-muted hover:bg-paper hover:text-ink">Back to login options</button>
        </div>
      ) : (
        <form action={action} className="mt-5">
          <input type="hidden" name="role" value={role} />
          <h1 className="font-display text-title font-bold text-ink">Login as {roleCards.flatMap((card) => card.roles).find((option) => option.role === role)?.title ?? "staff"}</h1>
          <p className="mt-1 text-body text-muted">Use the phone and PIN assigned by your restaurant.</p>
          <label className="mt-5 block text-body font-semibold text-ink">
            Outlet code
            <span className="mt-0.5 block text-caption font-normal text-muted">The short code for your restaurant, e.g. SPI42</span>
            <input name="outlet" defaultValue={state.outlet} required maxLength={12} pattern="[A-Za-z0-9]{2,12}" title="2-12 letters or numbers" onInput={(e) => { e.currentTarget.value = e.currentTarget.value.replace(/[^A-Za-z0-9]/g, ""); }} autoCapitalize="characters" autoComplete="organization" placeholder="SPI42" className={`${field} font-mono uppercase`} />
          </label>
          <label className="mt-3 block text-body font-semibold text-ink">
            Phone number
            <input name="phone" defaultValue={state.phone} required inputMode="tel" autoComplete="tel" placeholder="98765 43210" className={field} />
          </label>
          <label className="mt-3 block text-body font-semibold text-ink">
            4-digit PIN
            <input name="pin" required inputMode="numeric" pattern="\d{4}" maxLength={4} type="password" autoComplete="current-password" className={`${field} tracking-[0.5em]`} />
          </label>
          {state.error && state.role === role && <p role="alert" className="mt-3 rounded-input bg-[var(--state-seated-soft)] px-3 py-2 text-body font-semibold text-danger">{state.error}</p>}
          <button type="submit" disabled={pending} className="mt-5 h-12 w-full rounded-input bg-ink text-button font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-60">
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" onClick={() => { setSelectedRole(null); setSelectedGroup(null); }} className="mt-3 min-h-10 w-full rounded-input px-3 text-body font-semibold text-muted hover:bg-paper hover:text-ink">Choose a different login</button>
          <p className="mt-3 text-center text-caption text-muted">Forgot your PIN? Ask the restaurant owner or your Tableeqr contact to reset it.</p>
        </form>
      )}
    </section>
  );
}
