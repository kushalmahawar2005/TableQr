"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";

const field = "mt-1 block h-12 w-full rounded-input border border-line bg-surface px-3 text-section text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20";

export function SignInForm({ outlet }: { outlet: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, { error: null, outlet, phone: "" });
  return (
    <form action={action} className="w-full max-w-sm rounded-card border border-line bg-surface p-6">
      <p className="font-display text-section font-bold text-ink">TableQR</p>
      <h1 className="mt-1 font-display text-title font-bold text-ink">Staff sign in</h1>
      <label className="mt-5 block text-body font-semibold text-ink">
        Outlet code
        <input name="outlet" defaultValue={state.outlet} required autoCapitalize="characters" autoComplete="organization" className={`${field} uppercase`} />
      </label>
      <label className="mt-3 block text-body font-semibold text-ink">
        Phone number
        <input name="phone" defaultValue={state.phone} required inputMode="tel" autoComplete="tel" className={field} />
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
      <button type="submit" disabled={pending} className="mt-5 h-12 w-full rounded-input bg-ink text-button font-semibold text-white disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
