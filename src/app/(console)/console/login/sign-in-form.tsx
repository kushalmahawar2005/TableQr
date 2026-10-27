"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";

const field = "mt-1 block h-12 w-full rounded-input border border-line bg-surface px-3 text-section text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20";

export function SignInForm({ outlet }: { outlet: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, { error: null, outlet, phone: "" });
  return (
    <form action={action} className="w-full max-w-sm rounded-[1.25rem] border border-line bg-surface p-6 shadow-modal sm:p-8">
      <div className="flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-input bg-ink font-display text-section font-bold text-white" aria-hidden="true">T</span>
        <p className="font-display text-section font-bold text-ink">TableQR</p>
      </div>
      <h1 className="mt-5 font-display text-title font-bold text-ink">Welcome back</h1>
      <p className="mt-1 text-body text-muted">Sign in with the details your TableQR contact gave you.</p>
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
      {state.error && (
        <p role="alert" className="mt-3 rounded-input bg-[var(--state-seated-soft)] px-3 py-2 text-body font-semibold text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="mt-6 h-12 w-full rounded-input bg-ink text-button font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="mt-5 text-center text-caption text-muted">Forgot your PIN? Ask the restaurant owner or your TableQR contact to reset it.</p>
    </form>
  );
}
