"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, Cancel01Icon, CheckmarkCircle02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  const pct = days === null ? 100 : Math.max(3, Math.min(100, Math.round((days / 30) * 100)));
  return (
    <section aria-label="Current plan" className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-body text-muted">Current plan</p>
          <div className="mt-1 flex items-center gap-2.5">
            <h2 className="font-display text-title font-bold text-ink">{plan.planName}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${TONE[st.tone].chip}`}>{st.chip}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-title font-bold text-ink tabular">{money(plan.fee.totalPaise)}</p>
          <p className="text-caption text-muted">per month{plan.fee.outletCount > 1 ? `, ${plan.fee.outletCount} outlets` : ""}</p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3 text-body">
          <span className={running ? "text-ink" : "font-semibold text-danger"}>{running && days !== null ? `${st.line}` : st.line}</span>
          {running && days !== null && <span className="text-muted">{days <= 0 ? "ends today" : `${days} ${days === 1 ? "day" : "days"} left`}</span>}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
          <div className={`h-full rounded-full ${TONE[st.tone].tick}`} style={{ width: `${running ? pct : 100}%` }} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ...(plan.features.dineIn ? [["Tables", plan.features.maxTables ?? "Any"]] : []),
          ...(plan.features.rooms ? [["Rooms", plan.features.maxRooms ?? "Any"]] : []),
          ["Staff logins", plan.features.maxStaff ?? "Any"],
          ["Outlets", plan.fee.outletCount],
          [plan.access.reason === "trial" ? "Trial until" : "Paid until", plan.access.endsAt === null ? "—" : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(plan.access.endsAt))],
        ].map(([label, value]) => (
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
        Cashfree is checking the payment. {upgrade ? `${upgrade} starts automatically after confirmation.` : "Your plan extends automatically after confirmation."}
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
  const requests = useRef(new Map<string, string>());

  const perMonth = target?.monthlyPricePaise != null ? target.monthlyPricePaise * plan.fee.outletCount : plan.fee.totalPaise;
  const amount = perMonth * months;

  const pay = async () => {
    setState("busy");
    setError(null);
    const requestId = crypto.randomUUID();
    const r = await startFeePaymentAction({ months, planCode: target?.code ?? null, requestId });
    if (!r.ok) {
      setError(r.error);
      setState("idle");
      return;
    }
    try {
      await openCheckout(r.payment.checkout);
      setState("sent");
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Cashfree checkout could not open. Try again.");
      setState("idle");
    }
  };

  const shell = bare ? "" : "overflow-hidden rounded-[22px] border border-line bg-surface";
  const pendingId = plan.payments.find((payment) => payment.method === "cashfree" && payment.status === "claimed")?.id;
  if (state === "sent") return <section aria-label="Pay TableQR" className={shell}><Sent upgrade={target?.name} paymentId={pendingId} /></section>;

  return (
    <section aria-label="Pay TableQR" className={shell}>
      <div className="p-5 sm:p-6">
        {!bare && <h2 className="font-display text-section font-bold text-ink">Pay for {target ? target.name : "your plan"}</h2>}

        <fieldset className={bare ? "" : "mt-4"}>
          <legend className="text-caption text-muted">Pay for</legend>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {MONTHS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={months === m}
                onClick={() => setMonths(m)}
                className={`flex min-h-14 flex-col items-center justify-center rounded-xl border text-center transition-colors ${focus} ${months === m ? "border-ink bg-ink text-paper" : "border-line text-ink hover:border-ink/40"}`}
              >
                <span className="text-body font-semibold">{m === 12 ? "1 yr" : `${m} mo`}</span>
                <span className={`text-[11px] tabular ${months === m ? "opacity-80" : "text-muted"}`}>{money(perMonth * m)}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 rounded-2xl bg-paper p-4 text-center">
          <p className="text-caption text-muted">Total payable</p>
          <p className="mt-1 font-display text-title font-bold text-ink tabular">{money(amount)}</p>
          <p className="mt-1 text-caption text-muted">UPI, cards and other available methods are shown securely by Cashfree.</p>
        </div>
      </div>

      <form
        className="space-y-3 border-t border-line p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}
      >
        <button type="submit" disabled={state === "busy" || amount <= 0} className={`flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-4 text-button font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-40 ${focus}`}>
          {state === "busy" ? "Opening Cashfree…" : `Pay ${money(amount)} securely`}
        </button>
        <p className="text-center text-caption text-muted">Your plan updates automatically after Cashfree confirms the payment.</p>
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
      <button type="button" onClick={() => setOpen(true)} className={`mt-5 inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-button font-semibold text-ink hover:bg-ink/5 ${focus}`}>
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
  const currentIndex = plan.plans.findIndex((p) => p.code === plan.planCode);
  const [target, setTarget] = useState<PlanOption | null>(null);
  if (plan.plans.length < 2) return null;
  const popular = plan.plans.find((p) => p.code === "growth")?.code;

  return (
    <section aria-label="Plans">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-section font-bold text-ink">Plans</h2>
          <p className="text-body text-muted">Switch to a bigger plan any time. Your menu, tables and bills stay as they are.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plan.plans.map((p, i) => {
          const current = p.code === plan.planCode;
          const smaller = currentIndex !== -1 && i < currentIndex;
          return (
            <div key={p.code} className={`relative flex flex-col rounded-2xl border bg-surface p-5 ${current ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "border-line"}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-section font-bold text-ink">{p.name}</h3>
                {current ? (
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-caption font-semibold text-paper">Current plan</span>
                ) : p.code === popular ? (
                  <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-caption font-semibold text-brand-strong">Popular</span>
                ) : null}
              </div>
              {TAGLINE[p.code] && <p className="mt-1 min-h-10 text-caption text-muted">{TAGLINE[p.code]}</p>}
              <p className="mt-4">
                <span className="font-display text-[2rem] font-extrabold leading-none text-ink tabular">{p.monthlyPricePaise === null ? "Custom" : money(p.monthlyPricePaise)}</span>
                {p.monthlyPricePaise !== null && <span className="text-body text-muted"> /month</span>}
              </p>
              <p className="mt-1 text-caption text-muted">per outlet</p>

              <div className="mt-5">
                {current ? (
                  <span className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line text-button font-semibold text-muted">Your plan</span>
                ) : smaller ? (
                  <span className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line text-button font-semibold text-muted">Smaller plan</span>
                ) : p.monthlyPricePaise === null ? (
                  <span className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line text-button font-semibold text-muted">Call TableQR</span>
                ) : (
                  <button type="button" onClick={() => setTarget(p)} className={`flex min-h-11 w-full items-center justify-center rounded-xl text-button font-semibold ${p.code === popular ? "bg-brand text-brand-on hover:bg-brand-hover" : "bg-ink text-paper hover:bg-ink/90"} ${focus}`}>
                    Switch to {p.name}
                  </button>
                )}
              </div>

              <ul className="mt-5 space-y-2.5 border-t border-line pt-5">
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
            </div>
          );
        })}
      </div>
      {target && <SwitchPlan plan={plan} target={target} onClose={() => setTarget(null)} />}
    </section>
  );
}

const STEPS = ["What changes", "Pay"] as const;

/** The switch to a bigger plan, as a sheet with three steps */
function SwitchPlan({ plan, target, onClose }: { plan: PlanView; target: PlanOption; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const gained = FEATURE_KEYS.filter((k) => target.features[k] && !plan.features[k]);
  const current = plan.plans.find((p) => p.code === plan.planCode);
  const diff = target.monthlyPricePaise !== null && current?.monthlyPricePaise != null ? (target.monthlyPricePaise - current.monthlyPricePaise) * plan.fee.outletCount : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Switch to ${target.name}`} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[22px] border border-line bg-surface outline-none sm:rounded-[22px]">
        <div className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-display text-section font-bold text-ink">
              {plan.planName} to {target.name}
            </p>
            <button type="button" onClick={onClose} aria-label="Close" className={`grid size-9 place-items-center rounded-lg text-muted hover:bg-ink/5 ${focus}`}>
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

        {step === 0 && (
          <div className="space-y-5 p-6">
            <div>
              <p className="text-body text-muted">You get</p>
              <ul className="mt-2 space-y-2">
                {gained.map((k) => (
                  <li key={k} className="flex gap-3">
                    <HugeiconsIcon icon={Tick02Icon} size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
                    <span>
                      <span className="block text-body font-semibold text-ink">{FEATURE_LABELS[k].label}</span>
                      <span className="block text-caption text-muted">{FEATURE_LABELS[k].hint}</span>
                    </span>
                  </li>
                ))}
                <li className="flex gap-3">
                  <HugeiconsIcon icon={Tick02Icon} size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
                  <span className="text-body text-ink">
                    Up to {target.features.dineIn && <><span className="font-semibold">{target.features.maxTables ?? "any number of"} tables</span>, </>}{target.features.rooms && <><span className="font-semibold">{target.features.maxRooms ?? "any number of"} rooms</span>, </>}and <span className="font-semibold">{target.features.maxStaff ?? "any number of"} staff logins</span>
                  </span>
                </li>
              </ul>
            </div>
            <div className="flex items-baseline justify-between rounded-xl bg-paper px-4 py-3">
              <span className="text-body text-muted">New price</span>
              <span className="text-body text-ink">
                <span className="font-display text-section font-bold tabular">{money((target.monthlyPricePaise ?? 0) * plan.fee.outletCount)}</span> a month
                {diff !== null && diff > 0 && <span className="block text-right text-caption text-muted">{money(diff)} more than now</span>}
              </span>
            </div>
            <button type="button" onClick={() => setStep(1)} className={`flex min-h-12 w-full items-center justify-center rounded-xl bg-ink px-4 text-button font-semibold text-paper ${focus}`}>
              Continue to pay
            </button>
          </div>
        )}

        {step === 1 && (
          <div>
            <button type="button" onClick={() => setStep(0)} className={`ml-5 mt-4 inline-flex items-center gap-1 rounded-lg px-1 text-caption font-semibold text-muted hover:text-ink ${focus}`}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
              What changes
            </button>
            <PayCard plan={{ ...plan, waiting: false }} target={target} bare />
          </div>
        )}

      </div>
    </div>
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
                  {p.reference && <span className="block text-caption tabular">{p.reference}</span>}
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
