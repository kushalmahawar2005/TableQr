"use client";

import { useActionState } from "react";
import { adminLoginAction, createTenantAction, type AdminLoginState, type TenantState } from "./actions";

const field = "mt-1 block h-10 w-full rounded-input border border-line bg-surface px-3 text-body text-ink outline-none focus:border-ink";

export function AdminLogin() {
  const [state, action, pending] = useActionState<AdminLoginState, FormData>(adminLoginAction, { error: null });
  return <form action={action} className="mx-auto w-full max-w-sm rounded-card border border-line bg-surface p-6">
    <h1 className="font-display text-title font-medium">Platform admin</h1>
    <p className="mt-1 text-muted">Sign in to manage restaurants.</p>
    <label className="mt-5 block text-body font-semibold">Email<input name="email" type="email" required className={field} /></label>
    <label className="mt-3 block text-body font-semibold">Password<input name="password" type="password" required className={field} /></label>
    {state.error && <p role="alert" className="mt-3 text-body text-danger">{state.error}</p>}
    <button disabled={pending} className="mt-5 h-10 w-full rounded-input bg-ink text-button text-white disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}

export function CreateTenantForm({ plans }: { plans: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<TenantState, FormData>(createTenantAction, { error: null, success: null });
  return <form action={action} className="rounded-card border border-line bg-surface p-5">
    <h2 className="font-display text-section font-medium">Add restaurant</h2>
    <p className="mt-1 text-muted">Creates the first outlet, owner, zone, tables and QR codes.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-body font-semibold">Restaurant name<input name="tenantName" required className={field} /></label>
      <label className="text-body font-semibold">Plan<select name="planCode" required className={field}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
      <label className="text-body font-semibold">Contact name<input name="contactName" required className={field} /></label>
      <label className="text-body font-semibold">Contact phone<input name="contactPhone" required className={field} /></label>
      <label className="text-body font-semibold">Contact email<input name="contactEmail" type="email" className={field} /></label>
      <label className="text-body font-semibold">Brand name<input name="brandName" className={field} /></label>
      <label className="text-body font-semibold">Outlet code<input name="outletCode" required placeholder="SRJ01" className={`${field} uppercase`} /></label>
      <label className="text-body font-semibold">Outlet name<input name="outletName" required className={field} /></label>
      <label className="text-body font-semibold">City<input name="city" required className={field} /></label>
      <label className="text-body font-semibold">Address<input name="address" required className={field} /></label>
      <label className="text-body font-semibold">Owner name<input name="ownerName" required className={field} /></label>
      <label className="text-body font-semibold">Owner phone<input name="ownerPhone" required className={field} /></label>
      <label className="text-body font-semibold">Owner 4-digit PIN<input name="ownerPin" required inputMode="numeric" pattern="\d{4}" maxLength={4} className={field} /></label>
      <label className="text-body font-semibold">Tables<input name="tableCount" type="number" min="1" max="100" defaultValue="4" required className={field} /></label>
    </div>
    {state.error && <p role="alert" className="mt-4 text-body text-danger">{state.error}</p>}
    {state.success && <p role="status" className="mt-4 text-body text-green-700">{state.success}</p>}
    <button disabled={pending} className="mt-5 h-10 rounded-input bg-ink px-5 text-button text-white disabled:opacity-60">{pending ? "Creating…" : "Create restaurant"}</button>
  </form>;
}
