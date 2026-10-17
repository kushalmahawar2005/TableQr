"use client";

import { useMemo, useState } from "react";
import { Cancel01Icon, CheckmarkCircle02Icon, Copy01Icon, SmartPhone01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  /** When the server read this, for days left */
  now: number;
  payments: { id: string; months: number; amountPaise: number; method: "upi" | "cash" | "bank"; reference: string | null; status: "claimed" | "confirmed" | "rejected"; createdAt: string; paidUntil: string | null }[];
};

const card = "rounded-card border border-line bg-surface";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const day = (v: number | string | null) => (v === null ? "—" : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(v)));
const MONTHS = [1, 3, 6, 12] as const;
const PERIOD: Record<number, string> = { 1: "1 month", 3: "3 months", 6: "6 months", 12: "1 year" };
const STATUS = {
  claimed: { label: "Being checked", tone: "bg-[var(--state-held-soft)] text-warning" },
  confirmed: { label: "Received", tone: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" },
  rejected: { label: "Not received", tone: "bg-danger/10 text-danger" },
} as const;
const METHOD = { upi: "UPI", cash: "Cash", bank: "Bank" } as const;

/** Days left and a coloured state: running, ending soon, ended (grace) or paused */
function standing(plan: PlanView, now: number) {
  const ends = plan.access.endsAt;
  const days = ends === null ? null : Math.ceil((ends - now) / 86_400_000);
  const trial = plan.access.reason === "trial";
  const good = "bg-[var(--state-available-soft)] text-[var(--state-available-text)]";
  if (plan.access.state === "blocked") return { chip: "Paused", tone: "bg-danger/10 text-danger", line: `${trial ? "Trial" : "Plan"} ended ${day(ends)}`, days };
  if (plan.access.state === "grace") return { chip: "Ended", tone: "bg-danger/10 text-danger", line: `${trial ? "Trial" : "Plan"} ended ${day(ends)} · pay to keep using TableQR`, days };
  if (days === null) return { chip: trial ? "Free trial" : "Active", tone: good, line: "No end date", days };
  return {
    chip: trial ? "Free trial" : "Active",
    tone: days <= 3 ? "bg-[var(--state-held-soft)] text-warning" : good,
    line: `${trial ? "Trial ends" : "Paid until"} ${day(ends)} · ${days <= 0 ? "ends today" : `${days} ${days === 1 ? "day" : "days"} left`}`,
    days,
  };
}

/** Plan name, price and how long it runs */
export function PlanSummary({ plan }: { plan: PlanView }) {
  const st = standing(plan, plan.now);
  const running = plan.access.state === "ok";
  const pct = st.days === null ? 100 : Math.max(0, Math.min(100, Math.round((st.days / 30) * 100)));
  return (
    <section className={`${card} p-5`} aria-label="Your plan">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">Your plan</p>
          <p className="mt-0.5 font-display text-title font-bold text-ink">{plan.planName}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-caption font-semibold ${st.tone}`}>{st.chip}</span>
      </div>
      <p className="mt-3 font-display text-section font-bold text-ink tabular">
        {money(plan.fee.totalPaise)}
        <span className="text-body font-normal text-muted"> / month</span>
      </p>
      {plan.fee.outletCount > 1 && <p className="text-caption text-muted">{plan.fee.outletCount} outlets × {money(plan.fee.perOutletPaise)}</p>}
      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
          <div className={`h-full rounded-full ${running && (st.days ?? 99) > 3 ? "bg-brand" : "bg-danger"}`} style={{ width: `${running ? pct : 100}%` }} />
        </div>
        <p className={`mt-2 text-body ${running ? "text-muted" : "font-semibold text-danger"}`}>{st.line}</p>
      </div>
    </section>
  );
}

/** Ticks and crosses for everything the plan switches on */
export function PlanIncludes({ plan }: { plan: PlanView }) {
  return (
    <section className={`${card} p-5`} aria-label="What your plan includes">
      <h2 className="font-display text-section font-bold text-ink">What your plan includes</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-input border border-line px-3 py-2.5">
          <p className="text-caption text-muted">Tables</p>
          <p className="font-display text-section font-bold text-ink tabular">{plan.features.maxTables ?? "No limit"}</p>
        </div>
        <div className="rounded-input border border-line px-3 py-2.5">
          <p className="text-caption text-muted">Staff logins</p>
          <p className="font-display text-section font-bold text-ink tabular">{plan.features.maxStaff ?? "No limit"}</p>
        </div>
      </div>
      <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {FEATURE_KEYS.map((k) => {
          const on = plan.features[k];
          return (
            <li key={k} className={`flex items-start gap-2 text-body ${on ? "text-ink" : "text-muted"}`}>
              <HugeiconsIcon icon={on ? Tick02Icon : Cancel01Icon} size={18} className={`mt-0.5 shrink-0 ${on ? "text-success" : "opacity-50"}`} aria-hidden />
              <span>
                {FEATURE_LABELS[k].label}
                <span className="sr-only">{on ? " included" : " not included"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Everything paid to TableQR, newest first */
export function PlanPayments({ plan }: { plan: PlanView }) {
  if (!plan.payments.length) return null;
  return (
    <section className={`${card} p-5`} aria-label="Your payments">
      <h2 className="font-display text-section font-bold text-ink">Your payments</h2>
      <ul className="mt-2 divide-y divide-line">
        {plan.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">{PERIOD[p.months] ?? `${p.months} months`} · {money(p.amountPaise)}</p>
              <p className="text-caption text-muted">
                {day(p.createdAt)} · {METHOD[p.method]}
                {p.reference ? ` · ${p.reference}` : ""}
                {p.paidUntil ? ` · until ${day(p.paidUntil)}` : ""}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Choose how long, pay by UPI (QR or app link), then tell TableQR */
export function PayCard({ plan, upiId }: { plan: PlanView; upiId: string | null }) {
  const [months, setMonths] = useState<(typeof MONTHS)[number]>(1);
  const [method, setMethod] = useState<"upi" | "cash" | "bank">("upi");
  const [reference, setReference] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">(plan.waiting ? "sent" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const amount = plan.fee.totalPaise * months;
  const payUrl = upiId && amount > 0 ? upiPayUrl(upiId, amount / 100, `TableQR ${plan.outlet} ${months}m`) : null;
  const qr = useMemo(() => (payUrl ? qrSvg(payUrl, 220) : null), [payUrl]);

  if (state === "sent") {
    return (
      <section className={`${card} p-6 text-center`} aria-label="Pay TableQR">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={44} className="mx-auto text-success" aria-hidden />
        <h2 className="mt-3 font-display text-section font-bold text-ink">Payment sent for checking</h2>
        <p className="mt-1 text-body text-muted">TableQR will confirm it soon. Your plan updates by itself once it is confirmed.</p>
      </section>
    );
  }

  return (
    <section className={`${card} overflow-hidden`} aria-label="Pay TableQR">
      <div className="p-5">
        <h2 className="font-display text-section font-bold text-ink">Pay TableQR</h2>
        <div role="radiogroup" aria-label="How long to pay for" className="mt-3 grid grid-cols-4 gap-1 rounded-input bg-ink/5 p-1">
          {MONTHS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={months === m}
              onClick={() => setMonths(m)}
              className={`min-h-10 rounded-input text-caption font-semibold transition-colors ${focus} ${months === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {m === 12 ? "1 year" : `${m} mo`}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 rounded-input bg-brand-soft px-4 py-3">
          <div>
            <p className="text-caption font-semibold text-brand-strong">Total</p>
            <p className="text-caption text-muted">{money(plan.fee.totalPaise)} × {PERIOD[months]}</p>
          </div>
          <p className="font-display text-title font-bold text-ink tabular">{money(amount)}</p>
        </div>

        {payUrl ? (
          <div className="mt-5 flex flex-col items-center text-center">
            {qr && <div className="size-48 rounded-input border border-line bg-white p-2 shadow-sm" role="img" aria-label={`UPI QR code to pay ${money(amount)}`} dangerouslySetInnerHTML={{ __html: qr }} />}
            <p className="mt-2 text-caption text-muted">Scan with any UPI app</p>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(upiId!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-mono text-caption text-ink hover:bg-ink/5 ${focus}`}
            >
              {upiId}
              <HugeiconsIcon icon={Copy01Icon} size={14} aria-hidden />
              <span className="sr-only">Copy UPI ID</span>
            </button>
            {copied && <span role="status" className="mt-1 text-caption text-success">Copied</span>}
            <a href={payUrl} className={`mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-cta bg-brand px-5 text-button font-semibold text-brand-on hover:bg-brand-hover ${focus}`}>
              <HugeiconsIcon icon={SmartPhone01Icon} size={18} aria-hidden />
              Pay {money(amount)} in UPI app
            </a>
            <p className="mt-1.5 text-caption text-muted">On a phone this opens GPay, PhonePe or Paytm</p>
          </div>
        ) : (
          <p className="mt-4 rounded-input border border-line px-3 py-2.5 text-body text-muted">Pay TableQR by UPI, cash or bank as agreed, then tell us below.</p>
        )}
      </div>

      <form
        className="space-y-3 border-t border-line bg-ink/[0.02] p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setState("busy");
          setError(null);
          const r = await claimFeeAction({ months, method, reference });
          if (r.ok) setState("sent");
          else {
            setError(r.error);
            setState("idle");
          }
        }}
      >
        <div>
          <p className="text-body font-semibold text-ink">Paid already?</p>
          <p className="text-caption text-muted">Tell TableQR so we can confirm it.</p>
        </div>
        <div role="radiogroup" aria-label="How you paid" className="flex gap-2">
          {(["upi", "cash", "bank"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className={`min-h-10 flex-1 rounded-input border text-caption font-semibold ${focus} ${method === m ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink hover:border-ink/40"}`}
            >
              {METHOD[m]}
            </button>
          ))}
        </div>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value.slice(0, 60))}
          placeholder={method === "upi" ? "UPI reference (UTR), 12 digits" : "Note (optional)"}
          aria-label={method === "upi" ? "UPI reference number" : "Note"}
          inputMode={method === "upi" ? "numeric" : "text"}
          className={`h-12 w-full rounded-input border border-line bg-surface px-3 text-body text-ink placeholder:text-muted ${focus}`}
        />
        <button
          type="submit"
          disabled={state === "busy" || (method === "upi" && reference.trim().length < 6)}
          className={`inline-flex min-h-12 w-full items-center justify-center rounded-cta bg-ink px-5 text-button font-semibold text-paper disabled:opacity-50 ${focus}`}
        >
          {state === "busy" ? "Sending…" : `I have paid ${money(amount)}`}
        </button>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      </form>
    </section>
  );
}

/** Only the payment card, for the paused screen */
export function PlanPanel({ plan, upiId }: { plan: PlanView; upiId: string | null; compact?: boolean }) {
  return <PayCard plan={plan} upiId={upiId} />;
}
