"use client";

import { useCallback, useState } from "react";
import { ArrowLeft01Icon, Cancel01Icon, CheckmarkCircle02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { openCheckout } from "@/lib/payments/checkout";
import { FEATURE_KEYS, FEATURE_LABELS, type Features } from "@/lib/plan-features";
import { refreshFeePaymentAction, startFeePaymentAction } from "./plan-request-actions";

// "My plan": the restaurant's TableQR plan, paying through Cashfree, and moving to a bigger plan.

export type PlanOption = { code: string; name: string; monthlyPricePaise: number | null; features: Features };
export type PlanView = {
  planName: string;
  planCode: string;
  outlet: string;
  fee: { perOutletPaise: number; outletCount: number; totalPaise: number };
  access: { state: "ok" | "grace" | "blocked"; reason: string; endsAt: number | null };
  features: Features;
  plans: PlanOption[];
  waiting: boolean;
  /** When the server read this, for days left */
  now: number;
  payments: { id: string; planCode: string | null; months: number; amountPaise: number; method: "cashfree" | "upi" | "cash" | "bank"; reference: string | null; status: "claimed" | "confirmed" | "rejected"; createdAt: string; paidUntil: string | null }[];
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const day = (v: number | string | null) => (v === null ? "—" : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(v)));
const MONTHS = [1, 3, 6, 12] as const;
const PERIOD: Record<number, string> = { 1: "1 month", 3: "3 months", 6: "6 months", 12: "1 year" };
const METHOD = { cashfree: "Cashfree", upi: "UPI", cash: "Cash", bank: "Bank" } as const;

/** Days left, and whether it is time to pay: in the last week, on a trial, or once it has ended */
export function planDue(plan: PlanView) {
  const ends = plan.access.endsAt;
  const days = ends === null ? null : Math.ceil((ends - plan.now) / 86_400_000);
  const due = plan.access.state !== "ok" || plan.access.reason === "trial" || (days !== null && days <= 7);
  return { days, due };
}

/** The colour and words for where the plan stands */
function standing(plan: PlanView) {
  const { days } = planDue(plan);
  const trial = plan.access.reason === "trial";
  if (plan.access.state === "blocked") return { tone: "danger", chip: "Paused", line: `Ended ${day(plan.access.endsAt)}. Pay to start again.` } as const;
  if (plan.access.state === "grace") return { tone: "danger", chip: "Ended", line: `Ended ${day(plan.access.endsAt)}. Pay now to keep using TableQR.` } as const;
  if (days === null) return { tone: "good", chip: trial ? "Free trial" : "Active", line: "No end date set" } as const;
  const tone = days <= 3 ? "danger" : days <= 7 ? "warn" : "good";
  return { tone, chip: trial ? "Free trial" : "Active", line: `${trial ? "Trial ends" : "Renews"} ${day(plan.access.endsAt)}` } as const;
}
const TONE = {
  good: { chip: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]", tick: "bg-success" },
  warn: { chip: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]", tick: "bg-warning" },
  danger: { chip: "bg-danger/12 text-danger", tick: "bg-danger" },
} as const;

/** Current plan: name, price, when it renews, and a thin line for the time left */
export function PlanPass({ plan }: { plan: PlanView }) {
  const st = standing(plan);
  const { days } = planDue(plan);
  const running = plan.access.state === "ok";
  const metrics: [string, string | number][] = [
    ...(plan.features.dineIn ? [["Tables", plan.features.maxTables ?? "Any"] as [string, string | number]] : []),
    ...(plan.features.rooms ? [["Rooms", plan.features.maxRooms ?? "Any"] as [string, string | number]] : []),
    ["Staff logins", plan.features.maxStaff ?? "Any"],
    ["Outlets", plan.fee.outletCount],
  ];
  return (
    <section aria-label="Current plan" className="rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">Your current plan</p>
          <div className="mt-1 flex items-center gap-2.5">
            <h2 className="font-display text-title font-bold text-ink sm:text-[1.75rem]">{plan.planName}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${TONE[st.tone].chip}`}>{st.chip}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-title font-bold text-ink tabular">{money(plan.fee.totalPaise)}<span className="ml-1 text-body font-medium text-muted">/ month</span></p>
          <p className="text-caption text-muted">{plan.fee.outletCount > 1 ? `Across ${plan.fee.outletCount} outlets` : "For this outlet"}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-3.5">
        <div>
          <p className="text-caption text-muted">{plan.access.reason === "trial" ? "Trial ends" : running ? "Paid through" : "Access ended"}</p>
          <p className={`mt-0.5 text-body font-semibold ${running ? "text-ink" : "text-danger"}`}>{day(plan.access.endsAt)}</p>
        </div>
        {running && days !== null && <span className={`rounded-full px-3 py-1.5 text-caption font-semibold ${TONE[st.tone].chip}`}>{days <= 0 ? "Ends today" : `${days} ${days === 1 ? "day" : "days"} left`}</span>}
        {!running && <span className="text-caption font-medium text-danger">{st.line}</span>}
      </div>

      <div className={`mt-5 grid grid-cols-2 gap-3 ${metrics.length > 2 ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
        {metrics.map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-paper px-4 py-3">
            <p className="text-caption text-muted">{label}</p>
            <p className="font-display text-section font-bold text-ink tabular">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Sent({ upgrade, paymentId }: { upgrade?: string; paymentId?: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refresh = async () => {
    if (!paymentId) return window.location.reload();
    setRefreshing(true);
    setRefreshError(null);
    const result = await refreshFeePaymentAction(paymentId);
    if (!result.ok) {
      setRefreshing(false);
      setRefreshError(result.error);
      return;
    }
    window.location.reload();
  };
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-[var(--state-available-soft)]">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={30} className="text-success" aria-hidden />
      </span>
      <h3 className="mt-4 font-display text-section font-bold text-ink">Payment is being confirmed</h3>
      <p className="mt-1.5 max-w-xs text-body text-muted">
        Cashfree is checking the payment. {upgrade ? `Your plan switches to ${upgrade} after confirmation.` : "Your plan extends automatically after confirmation."}
      </p>
      <button type="button" disabled={refreshing} onClick={() => void refresh()} className={`mt-5 inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-button font-semibold text-ink hover:bg-ink/5 disabled:opacity-50 ${focus}`}>{refreshing ? "Checking…" : "Refresh status"}</button>
      {refreshError && <p role="alert" className="mt-2 text-caption text-danger">{refreshError}</p>}
    </div>
  );
}

/** Choose how long and open Cashfree's hosted checkout. */
export function PayCard({ plan, target, bare = false }: { plan: PlanView; target?: PlanOption; bare?: boolean }) {
  const [months, setMonths] = useState<(typeof MONTHS)[number]>(1);
  const [state, setState] = useState<"idle" | "busy" | "sent">(plan.waiting && !target ? "sent" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [startedPaymentId, setStartedPaymentId] = useState<string | undefined>();

  const perMonth = target?.monthlyPricePaise != null ? target.monthlyPricePaise * plan.fee.outletCount : plan.fee.totalPaise;
  const amount = perMonth * months;

  const pay = async () => {
    setState("busy");
    setError(null);
    try {
      const requestId = crypto.randomUUID();
      const r = await startFeePaymentAction({ months, planCode: target?.code ?? null, requestId });
      if (!r.ok) {
        setError(r.error);
        setState("idle");
        return;
      }
      setStartedPaymentId(r.payment.id);
      await openCheckout(r.payment.checkout);
      setState("sent");
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Cashfree checkout could not open. Try again.");
      setState("idle");
    }
  };

  const shell = bare ? "" : "overflow-hidden rounded-[22px] border border-line bg-surface";
  const pendingId = startedPaymentId ?? plan.payments.find((payment) => payment.method === "cashfree" && payment.status === "claimed")?.id;
  if (state === "sent") return <section aria-label="Pay TableQR" className={shell}><Sent upgrade={target?.name} paymentId={pendingId} /></section>;

  return (
    <section aria-label="Pay TableQR" className={shell}>
      {!bare && <div className="border-b border-line px-5 py-4 sm:px-6">
        <p className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">{target ? "Plan change" : "Subscription payment"}</p>
        <h2 className="mt-1 font-display text-section font-bold text-ink">{target ? `Switch to ${target.name}` : "Pay for your plan"}</h2>
        <p className="mt-1 text-caption text-muted">Your plan updates after Cashfree confirms the payment.</p>
      </div>}

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 rounded-2xl bg-paper p-4">
          <div>
            <p className="text-caption text-muted">Plan</p>
            <p className="mt-0.5 font-display text-section font-bold text-ink">{target?.name ?? plan.planName}</p>
            <p className="mt-1 text-caption text-muted">{money(perMonth)} per month{plan.fee.outletCount > 1 ? ` across ${plan.fee.outletCount} outlets` : ""}</p>
          </div>
          <span className="rounded-full bg-surface px-3 py-1 text-caption font-semibold text-muted">INR</span>
        </div>

        <fieldset className={bare ? "" : "mt-4"}>
          <legend className="text-body font-semibold text-ink">Choose billing period</legend>
          <p className="mt-0.5 text-caption text-muted">The total below covers {plan.fee.outletCount} {plan.fee.outletCount === 1 ? "outlet" : "outlets"}.</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MONTHS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={months === m}
                onClick={() => setMonths(m)}
                className={`flex min-h-[4.25rem] flex-col items-center justify-center rounded-xl border text-center transition-colors ${focus} ${months === m ? "border-brand bg-brand-soft text-brand-strong shadow-[inset_0_0_0_1px_var(--brand-main)]" : "border-line bg-surface text-ink hover:border-ink/40"}`}
              >
                <span className="text-body font-semibold">{m === 12 ? "1 yr" : `${m} mo`}</span>
                <span className={`mt-0.5 text-[11px] tabular ${months === m ? "text-brand-strong" : "text-muted"}`}>{money(perMonth * m)}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 overflow-hidden rounded-2xl border border-line">
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-body">
            <span className="text-muted">Billing period</span>
            <span className="font-semibold text-ink">{PERIOD[months]}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line bg-paper px-4 py-3.5">
            <span className="font-semibold text-ink">Total payable</span>
            <span className="font-display text-section font-bold text-ink tabular">{money(amount)}</span>
          </div>
        </div>
        <p className="mt-3 text-caption leading-relaxed text-muted">UPI, cards and other payment options are shown securely by Cashfree. You’ll review and confirm the payment there.</p>
      </div>

      <form
        className="space-y-3 border-t border-line p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}
      >
        <button type="submit" disabled={state === "busy" || amount <= 0} className={`flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-4 text-button font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-40 ${focus}`}>
          {state === "busy" ? "Opening secure checkout…" : `Continue to pay ${money(amount)}`}
        </button>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      </form>
    </section>
  );
}

/** Paid and not due yet: a calm panel, with paying in advance one tap away */
export function PayOrPaid({ plan }: { plan: PlanView }) {
  const { due, days } = planDue(plan);
  const [open, setOpen] = useState(false);
  if (due || open || plan.waiting) return <PayCard plan={plan} />;
  return (
    <section aria-label="Payment" className="rounded-[22px] border border-line bg-surface p-6">
      <span className="grid size-11 place-items-center rounded-full bg-[var(--state-available-soft)]">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={24} className="text-success" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-section font-bold text-ink">Nothing to pay right now</h2>
      <p className="mt-1 text-body text-muted">
        You are paid until {day(plan.access.endsAt)}. A reminder shows here a week before that{days !== null ? `, in ${Math.max(0, days - 7)} days` : ""}.
      </p>
      <button type="button" onClick={() => setOpen(true)} className={`mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-button font-semibold text-paper hover:bg-ink/90 ${focus}`}>
        Pay in advance
      </button>
    </section>
  );
}

const TAGLINE: Record<string, string> = {
  starter: "QR ordering and billing for a small cafe",
  growth: "For busy restaurants with waiters and bookings",
  pro: "Kitchen screen, pricing and full reports",
  chain: "For many outlets under one brand",
};

/** The plans as pricing cards; the current one is marked, bigger ones open the switch in steps */
export function ComparePlans({ plan }: { plan: PlanView }) {
  const [target, setTarget] = useState<PlanOption | null>(null);
  if (plan.plans.length < 2) return null;
  const popular = plan.plans.find((p) => p.code === "growth")?.code;
  const orderedPlans = [...plan.plans].sort((a, b) => {
    if (a.code === plan.planCode) return -1;
    if (b.code === plan.planCode) return 1;
    return (a.monthlyPricePaise ?? Number.MAX_SAFE_INTEGER) - (b.monthlyPricePaise ?? Number.MAX_SAFE_INTEGER);
  });
  const currentPrice = plan.fee.totalPaise;

  return (
    <section aria-label="Plans">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-section font-bold text-ink">Plans</h2>
          <p className="text-body text-muted">Choose the right fit. We’ll show every feature and limit change before payment.</p>
        </div>
      </div>
      <div className="mt-4 grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {orderedPlans.map((p) => {
          const current = p.code === plan.planCode;
          const monthlyTotal = p.monthlyPricePaise === null ? null : p.monthlyPricePaise * plan.fee.outletCount;
          const cheaper = monthlyTotal !== null && monthlyTotal < currentPrice;
          return (
            <article key={p.code} className={`relative flex h-full flex-col rounded-2xl border bg-surface p-5 ${current ? "border-brand shadow-[0_0_0_1px_var(--brand-main)]" : "border-line"}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-section font-bold text-ink">{p.name}</h3>
                {current ? (
                  <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-caption font-semibold text-brand-strong">Current plan</span>
                ) : p.code === popular ? (
                  <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-caption font-semibold text-brand-strong">Popular</span>
                ) : null}
              </div>
              <p className="mt-1 min-h-10 text-caption text-muted">{TAGLINE[p.code] ?? "\u00a0"}</p>
              <p className="mt-4 flex min-h-10 items-baseline">
                <span className="font-display text-[2rem] font-extrabold leading-none text-ink tabular">{p.monthlyPricePaise === null ? "Custom" : money(p.monthlyPricePaise)}</span>
                {p.monthlyPricePaise !== null && <span className="text-body text-muted"> /month</span>}
              </p>
              <p className="mt-1 text-caption text-muted">per outlet</p>

              <div className="mt-5">
                {current ? (
                  <span className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line text-button font-semibold text-muted">Your plan</span>
                ) : p.monthlyPricePaise === null ? (
                  <span className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line text-button font-semibold text-muted">Call TableQR</span>
                ) : (
                  <button type="button" onClick={() => setTarget(p)} className={`flex min-h-11 w-full items-center justify-center rounded-xl text-button font-semibold ${p.code === popular ? "bg-brand text-brand-on hover:bg-brand-hover" : "bg-ink text-paper hover:bg-ink/90"} ${focus}`}>
                    Switch to {p.name}
                  </button>
                )}
              </div>
              <p className="mt-2 min-h-5 text-center text-caption font-medium text-muted">{!current && cheaper ? `${money(currentPrice - monthlyTotal!)} less per month across your outlets` : "\u00a0"}</p>

              <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
                <h4 className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">What’s included</h4>
                <span className="text-caption text-muted">{FEATURE_KEYS.filter((k) => p.features[k]).length} features</span>
              </div>
              <ul className="mt-3 space-y-2.5">
                <li className="flex gap-2 text-body text-ink"><HugeiconsIcon icon={Tick02Icon} size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />{p.features.dineIn ? `${p.features.maxTables ?? "Any number of"} tables, ` : ""}{p.features.rooms ? `${p.features.maxRooms ?? "Any number of"} rooms, ` : ""}{p.features.maxStaff ?? "any"} staff</li>
                <li className="flex gap-2 text-body text-ink"><HugeiconsIcon icon={Tick02Icon} size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />QR ordering, billing, KOT</li>
                {FEATURE_KEYS.map((k) => (
                  <li key={k} className={`flex gap-2 text-body ${p.features[k] ? "text-ink" : "text-muted/60"}`}>
                    <HugeiconsIcon icon={p.features[k] ? Tick02Icon : Cancel01Icon} size={18} className={`mt-0.5 shrink-0 ${p.features[k] ? "text-success" : ""}`} aria-hidden />
                    {FEATURE_LABELS[k].label}
                    <span className="sr-only">{p.features[k] ? " included" : " not included"}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      {target && <SwitchPlan plan={plan} target={target} onClose={() => setTarget(null)} />}
    </section>
  );
}

const STEPS = ["Review changes", "Pay"] as const;

/** Compare the real plan changes before opening checkout. */
function SwitchPlan({ plan, target, onClose }: { plan: PlanView; target: PlanOption; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const gained = FEATURE_KEYS.filter((k) => target.features[k] && !plan.features[k]);
  const lost = FEATURE_KEYS.filter((k) => plan.features[k] && !target.features[k]);
  const currentMonthly = plan.fee.totalPaise;
  const targetMonthly = (target.monthlyPricePaise ?? 0) * plan.fee.outletCount;
  const diff = target.monthlyPricePaise === null ? null : targetMonthly - currentMonthly;
  const limit = (included: boolean, value: number | null) => !included ? "Not included" : value === null ? "No limit" : `${value}`;
  const limits = [
    { label: "Tables", from: limit(plan.features.dineIn, plan.features.maxTables), to: limit(target.features.dineIn, target.features.maxTables) },
    { label: "Rooms", from: limit(plan.features.rooms, plan.features.maxRooms), to: limit(target.features.rooms, target.features.maxRooms) },
    { label: "Staff logins", from: limit(true, plan.features.maxStaff), to: limit(true, target.features.maxStaff) },
  ];
  const limitLosses = limits.filter(({ from, to }) => {
    if (from === to || from === "Not included") return false;
    if (to === "Not included") return true;
    if (to === "No limit") return false;
    if (from === "No limit") return true;
    return Number(to) < Number(from);
  });
  const needsAcknowledgement = lost.length > 0 || limitLosses.length > 0 || (diff !== null && diff < 0);
  const close = useCallback(() => onClose(), [onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="flex max-h-[92dvh] max-w-xl flex-col gap-0 overflow-hidden rounded-t-[22px] border border-line bg-surface p-0 text-ink sm:rounded-[22px] sm:max-w-xl">
        <div className="z-10 shrink-0 border-b border-line bg-surface px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">Plan change</p>
              <DialogTitle className="mt-1 font-display text-section font-bold text-ink">Switch to {target.name}</DialogTitle>
              <DialogDescription className="mt-1 text-caption text-muted">Review what changes from {plan.planName} before you continue.</DialogDescription>
            </div>
            <button type="button" onClick={close} aria-label="Close" className={`grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-ink/5 ${focus}`}>
              <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
            </button>
          </div>
          <ol className="mt-3 grid grid-cols-2 gap-2" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined}>
                <span className={`block h-1 rounded-full ${i <= step ? "bg-brand" : "bg-ink/10"}`} />
                <span className={`mt-1.5 block text-caption ${i === step ? "font-semibold text-ink" : "text-muted"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 0 && (
            <div className="space-y-5 p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { name: plan.planName, price: currentMonthly, label: "Current plan", selected: false },
                  { name: target.name, price: targetMonthly, label: "New plan", selected: true },
                ].map((item) => (
                  <div key={item.label} className={`rounded-2xl border p-4 ${item.selected ? "border-brand bg-brand-soft/40" : "border-line bg-paper"}`}>
                    <p className="text-caption font-medium text-muted">{item.label}</p>
                    <p className="mt-1 font-display text-section font-bold text-ink">{item.name}</p>
                    <p className="mt-2 text-body text-ink"><span className="font-semibold tabular">{money(item.price)}</span><span className="text-muted"> / month{plan.fee.outletCount > 1 ? ` · ${plan.fee.outletCount} outlets` : ""}</span></p>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-2xl border border-line">
                <div className="grid grid-cols-[1fr_auto_auto] gap-4 bg-paper px-4 py-2.5 text-caption font-semibold text-muted">
                  <span>Plan limits</span><span>Now</span><span>With {target.name}</span>
                </div>
                {limits.map((item) => (
                  <div key={item.label} className="grid grid-cols-[1fr_auto_auto] gap-4 border-t border-line px-4 py-2.5 text-body">
                    <span className="text-muted">{item.label}</span><span className="text-ink">{item.from}</span><span className="font-semibold text-ink">{item.to}</span>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-body font-semibold text-ink">Included with {target.name}</p>
                {gained.length ? (
                  <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                    {gained.map((k) => (
                      <li key={k} className="flex gap-2.5 rounded-xl bg-paper p-3">
                        <HugeiconsIcon icon={Tick02Icon} size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
                        <span>
                          <span className="block text-body font-semibold text-ink">{FEATURE_LABELS[k].label}</span>
                          <span className="mt-0.5 block text-caption leading-relaxed text-muted">{FEATURE_LABELS[k].hint}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1 text-caption text-muted">Your features stay the same; the plan limits and billing will change.</p>}
              </div>

              {diff !== null && diff !== 0 && <p className="rounded-xl bg-paper px-4 py-3 text-caption text-muted">The new plan is <span className="font-semibold text-ink">{money(Math.abs(diff))} {diff > 0 ? "more" : "less"} per month</span> across your outlets.</p>}

              {needsAcknowledgement && (
                <div className="rounded-2xl border border-[var(--state-held)]/30 bg-[var(--state-held-soft)] p-4">
                  <p className="text-body font-semibold text-[var(--state-held-text)]">{lost.length || limitLosses.length ? "What changes on this plan" : "Confirm this plan change"}</p>
                  {!lost.length && !limitLosses.length && <p className="mt-1 text-caption text-[var(--state-held-text)]">This plan has a lower monthly price. Your subscription will switch after payment is confirmed.</p>}
                  <ul className="mt-2 space-y-1.5 text-caption text-[var(--state-held-text)]">
                    {lost.map((k) => <li key={k}>• {FEATURE_LABELS[k].label}</li>)}
                    {limitLosses.map(({ label, from, to }) => <li key={label}>• {label}: {from} now → {to}</li>)}
                  </ul>
                  <label className="mt-3 flex cursor-pointer items-start gap-2.5 border-t border-[var(--state-held)]/20 pt-3 text-caption font-medium text-ink">
                    <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-main)]" />
                    <span>I understand the plan, feature and billing changes shown above.</span>
                  </label>
                </div>
              )}
              <button type="button" disabled={needsAcknowledgement && !acknowledged} onClick={() => setStep(1)} className={`flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-4 text-button font-semibold text-brand-on hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45 ${focus}`}>
                Choose payment period
              </button>
            </div>
          )}

          {step === 1 && (
            <div>
              <button type="button" onClick={() => setStep(0)} className={`ml-5 mt-4 inline-flex items-center gap-1 rounded-lg px-1 text-caption font-semibold text-muted hover:text-ink ${focus}`}>
                <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
                Back to plan comparison
              </button>
              <PayCard plan={{ ...plan, waiting: false }} target={target} bare />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const STATUS = {
  claimed: { label: "Being checked", tone: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]" },
  confirmed: { label: "Paid", tone: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" },
  rejected: { label: "Not received", tone: "bg-danger/12 text-danger" },
} as const;

/** Every payment to TableQR, newest first */
export function PlanPayments({ plan }: { plan: PlanView }) {
  if (!plan.payments.length) return null;
  const nameOf = (code: string | null) => plan.plans.find((p) => p.code === code)?.name;
  return (
    <section aria-label="Billing history" className="rounded-2xl border border-line bg-surface">
      <h2 className="px-6 pt-5 font-display text-section font-bold text-ink">Billing history</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-body">
          <thead>
            <tr className="text-caption text-muted">
              <th scope="col" className="px-6 py-2 font-medium">Date</th>
              <th scope="col" className="px-3 py-2 font-medium">For</th>
              <th scope="col" className="px-3 py-2 font-medium">Paid by</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
              <th scope="col" className="px-6 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {plan.payments.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="whitespace-nowrap px-6 py-3 text-ink">{day(p.createdAt)}</td>
                <td className="px-3 py-3 text-ink">
                  {nameOf(p.planCode) ? `${nameOf(p.planCode)} plan, ` : ""}
                  {PERIOD[p.months] ?? `${p.months} months`}
                  {p.paidUntil && <span className="block text-caption text-muted">until {day(p.paidUntil)}</span>}
                </td>
                <td className="px-3 py-3 text-muted">
                  {METHOD[p.method]}
                  {p.reference && <span className="block max-w-36 truncate text-caption tabular" title={p.reference}>{p.reference}</span>}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-ink tabular">{money(p.amountPaise)}</td>
                <td className="px-6 py-3 text-right"><span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Only the payment card, for the paused screen */
export function PlanPanel({ plan }: { plan: PlanView; compact?: boolean }) {
  return <PayCard plan={plan} />;
}
