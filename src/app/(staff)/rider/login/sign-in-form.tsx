"use client";

import { useActionState } from "react";
import { signInRiderAction, type RiderSignInState } from "./actions";

const field = "mt-1 block h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink outline-none focus:border-[#c9482b] focus-visible:ring-2 focus-visible:ring-[#c9482b]/20";

export function RiderSignInForm({ outlet }: { outlet: string }) {
  const [state, action, pending] = useActionState<RiderSignInState, FormData>(signInRiderAction, { error: null, outlet, phone: "" });

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f3f1ec] px-4 py-8 text-ink">
      <section className="w-full max-w-sm rounded-[1.5rem] border border-line bg-surface p-6 shadow-modal sm:p-7" aria-label="Tableeqr Rider sign in">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl bg-[#c9482b] text-2xl text-white">🛵</span>
          <span><span className="block font-display text-lg font-bold">Tableeqr Rider</span><span className="block text-sm text-muted">Delivery rider sign in</span></span>
        </div>
        <h1 className="mt-6 font-display text-title font-bold">Sign in as Rider</h1>
        <p className="mt-1 text-body text-muted">Use the outlet code, phone number and 4-digit PIN given by the restaurant.</p>
        <form action={action} className="mt-5">
          <label className="block text-body font-semibold">Outlet code
            <input name="outlet" defaultValue={state.outlet} required maxLength={12} pattern="[A-Za-z0-9]{2,12}" title="2-12 letters or numbers" onInput={(event) => { event.currentTarget.value = event.currentTarget.value.replace(/[^A-Za-z0-9]/g, ""); }} autoCapitalize="characters" autoComplete="organization" placeholder="SPI42" className={`${field} font-mono uppercase`} />
          </label>
          <label className="mt-3 block text-body font-semibold">Phone number
            <input name="phone" defaultValue={state.phone} required inputMode="tel" autoComplete="tel" placeholder="98765 43210" className={field} />
          </label>
          <label className="mt-3 block text-body font-semibold">4-digit PIN
            <input name="pin" required inputMode="numeric" pattern="\d{4}" maxLength={4} type="password" autoComplete="current-password" className={`${field} tracking-[0.5em]`} />
          </label>
          {state.error && <p role="alert" className="mt-3 rounded-xl bg-[var(--state-seated-soft)] px-3 py-2 text-body font-semibold text-danger">{state.error}</p>}
          <button type="submit" disabled={pending} className="mt-5 h-12 w-full rounded-xl bg-[#c9482b] text-button font-semibold text-white disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="mt-4 text-center text-caption text-muted">Rider access must be assigned by the restaurant owner.</p>
      </section>
    </main>
  );
}
