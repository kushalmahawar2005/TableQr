"use client";

import { useMemo, useState } from "react";
import { FEATURE_KEYS, FEATURE_LABELS, type Features } from "@/lib/plan-features";
import { upiPayUrl } from "@/lib/support";
import { qrSvg } from "@/server/floor/qr-svg";
import { claimFeeAction } from "./plan-request-actions";

// "My plan": what the restaurant pays TableQR, until when, and paying by UPI. The owner pays the
// operator directly, taps "I have paid", and TableQR confirms it by hand.

export type PlanView = {
  planName: string;
  outlet: string;
  fee: { perOutletPaise: number; outletCount: number; totalPaise: number };
  access: { state: "ok" | "grace" | "blocked"; reason: string; endsAt: number | null };
  features: Features;
  waiting: boolean;
  payments: { id: string; months: number; amountPaise: number; method: "upi" | "cash" | "bank"; reference: string | null; status: "claimed" | "confirmed" | "rejected"; createdAt: string; paidUntil: string | null }[];
};

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const day = (v: number | string | null) => (v === null ? "—" : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(v)));
const MONTHS = [1, 3, 6, 12] as const;
const STATUS = { claimed: "Being checked", confirmed: "Received", rejected: "Not received" } as const;

export function PlanPanel({ plan, upiId, compact = false }: { plan: PlanView; upiId: string | null; compact?: boolean }) {
  const [months, setMonths] = useState<(typeof MONTHS)[number]>(1);
  const [method, setMethod] = useState<"upi" | "cash" | "bank">("upi");
  const [reference, setReference] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">(plan.waiting ? "sent" : "idle");
  const [error, setError] = useState<string | null>(null);
  const amount = plan.fee.totalPaise * months;
  const payUrl = upiId && amount > 0 ? upiPayUrl(upiId, amount / 100, `TableQR ${plan.outlet} ${months}m`) : null;
  const qr = useMemo(() => (payUrl ? qrSvg(payUrl, 200) : null), [payUrl]);
  const ends = plan.access.endsAt;
  const what = plan.access.reason === "trial" ? "Free trial ends" : "Paid until";

  return (
    <div className={`space-y-5 text-left ${compact ? "" : "max-w-3xl"}`}>
      {!compact && (
        <section className="rounded-guest border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-caption font-semibold uppercase tracking-wider text-muted">Your plan</p>
              <p className="font-display text-title font-bold text-ink">{plan.planName}</p>
              <p className="text-body text-muted">{money(plan.fee.totalPaise)} per month{plan.fee.outletCount > 1 ? ` (${plan.fee.outletCount} outlets × ${money(plan.fee.perOutletPaise)})` : ""}</p>
            </div>
            <div className="text-right">
              <p className="text-caption text-muted">{what}</p>
              <p className={`font-display text-section font-bold ${plan.access.state === "ok" ? "text-ink" : "text-danger"}`}>{ends ? day(ends) : "Not set"}</p>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-guest border border-line bg-surface p-5">
        <h2 className="font-display text-section font-bold text-ink">Pay TableQR</h2>
        {state === "sent" ? (
          <p role="status" className="mt-2 text-body font-semibold text-[var(--state-available-text)]">Thank you! TableQR is checking your payment. Your plan updates as soon as it is confirmed.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {MONTHS.map((m) => (
                <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)} className={`min-h-11 rounded-cta border text-button font-semibold ${months === m ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink"}`}>
                  {m === 12 ? "1 year" : `${m} mo`}
                </button>
              ))}
            </div>
            <p className="mt-3 text-body text-muted">Amount: <span className="font-display text-section font-bold text-ink">{money(amount)}</span></p>
            {payUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-4">
                {qr && <div className="size-40 shrink-0 overflow-hidden rounded-input border border-line bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />}
                <div className="space-y-2 text-body text-muted">
                  <p>Scan with any UPI app, or on this phone:</p>
                  <a href={payUrl} className="inline-flex min-h-11 items-center rounded-cta bg-brand px-5 text-button font-semibold text-brand-on">Pay {money(amount)} with UPI</a>
                  <p className="text-caption">UPI ID: <span className="font-mono">{upiId}</span></p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-body text-muted">Pay TableQR by UPI, cash or bank as agreed, then tell us below.</p>
            )}

            <form
              className="mt-5 space-y-3 border-t border-line pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setState("busy");
                setError(null);
                const r = await claimFeeAction({ months, method, reference });
                if (r.ok) setState("sent");
                else { setError(r.error); setState("idle"); }
              }}
            >
              <p className="font-semibold text-ink">Paid already? Tell TableQR</p>
              <div className="flex flex-wrap gap-2">
                {(["upi", "cash", "bank"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`min-h-10 rounded-cta border px-4 text-caption font-semibold ${method === m ? "border-ink bg-ink text-white" : "border-line text-ink"}`}>
                    {m === "upi" ? "UPI" : m === "cash" ? "Cash" : "Bank"}
                  </button>
                ))}
              </div>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value.slice(0, 60))}
                placeholder={method === "upi" ? "UPI reference / UTR (12 digits)" : "Note (optional)"}
                aria-label="Payment reference"
                className="h-12 w-full rounded-input border border-line bg-surface px-3 text-body text-ink"
              />
              <button type="submit" disabled={state === "busy"} className="inline-flex min-h-11 items-center rounded-cta bg-ink px-5 text-button font-semibold text-white disabled:opacity-60">
                {state === "busy" ? "Sending…" : `I have paid ${money(amount)}`}
              </button>
              {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            </form>
          </>
        )}
      </section>

      {!compact && (
        <>
          <section className="rounded-guest border border-line bg-surface p-5">
            <h2 className="font-display text-section font-bold text-ink">What your plan includes</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              <li className="text-body text-ink">✓ Tables: {plan.features.maxTables ?? "No limit"} · Staff: {plan.features.maxStaff ?? "No limit"}</li>
              {FEATURE_KEYS.map((k) => <li key={k} className={`text-body ${plan.features[k] ? "text-ink" : "text-muted line-through"}`}>{plan.features[k] ? "✓" : "✕"} {FEATURE_LABELS[k].label}</li>)}
            </ul>
          </section>
          {plan.payments.length > 0 && (
            <section className="rounded-guest border border-line bg-surface p-5">
              <h2 className="font-display text-section font-bold text-ink">Your payments</h2>
              <ul className="mt-2 divide-y divide-line">
                {plan.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-body">
                    <span>{day(p.createdAt)} · {p.months === 12 ? "1 year" : `${p.months} ${p.months === 1 ? "month" : "months"}`}{p.paidUntil ? ` · until ${day(p.paidUntil)}` : ""}</span>
                    <span className="font-semibold">{money(p.amountPaise)} <span className={`ml-2 text-caption ${p.status === "confirmed" ? "text-[var(--state-available-text)]" : p.status === "rejected" ? "text-danger" : "text-muted"}`}>{STATUS[p.status]}</span></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
