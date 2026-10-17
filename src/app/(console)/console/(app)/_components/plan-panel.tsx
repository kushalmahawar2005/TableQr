"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight01Icon, Cancel01Icon, CheckmarkCircle02Icon, Copy01Icon, SmartPhone01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FEATURE_KEYS, FEATURE_LABELS, type Features } from "@/lib/plan-features";
import { upiPayUrl } from "@/lib/support";
import { qrSvg } from "@/server/floor/qr-svg";
import { claimFeeAction } from "./plan-request-actions";

// "My plan": what the restaurant pays TableQR, until when, paying by UPI, and upgrading in a few
// steps. The owner pays the operator directly and gives the UPI reference; TableQR checks the bank
// and confirms by hand, which starts the paid months (and the new plan, for an upgrade).

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
  payments: { id: string; planCode: string | null; months: number; amountPaise: number; method: "upi" | "cash" | "bank"; reference: string | null; status: "claimed" | "confirmed" | "rejected"; createdAt: string; paidUntil: string | null }[];
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
const isUtr = (v: string) => /^\d{12}$/.test(v.replace(/\s/g, ""));

/** Days left, and whether it is time to pay: in the last week, on a trial, or once it has ended */
export function planDue(plan: PlanView) {
  const ends = plan.access.endsAt;
  const days = ends === null ? null : Math.ceil((ends - plan.now) / 86_400_000);
  const due = plan.access.state !== "ok" || plan.access.reason === "trial" || (days !== null && days <= 7);
  return { days, due };
}

function standing(plan: PlanView) {
  const { days } = planDue(plan);
  const ends = plan.access.endsAt;
  const trial = plan.access.reason === "trial";
  const good = "bg-[var(--state-available-soft)] text-[var(--state-available-text)]";
  const soon = "bg-[var(--state-held-soft)] text-warning";
  if (plan.access.state === "blocked") return { chip: "Paused", tone: "bg-danger/10 text-danger", bar: "bg-danger", line: `${trial ? "Trial" : "Plan"} ended ${day(ends)}` };
  if (plan.access.state === "grace") return { chip: "Ended", tone: "bg-danger/10 text-danger", bar: "bg-danger", line: `${trial ? "Trial" : "Plan"} ended ${day(ends)} · pay to keep using TableQR` };
  if (days === null) return { chip: trial ? "Free trial" : "Active", tone: good, bar: "bg-success", line: "No end date" };
  return {
    chip: trial ? "Free trial" : "Active",
    tone: days <= 7 ? soon : good,
    bar: days <= 3 ? "bg-danger" : days <= 7 ? "bg-warning" : "bg-success",
    line: `${trial ? "Trial ends" : "Paid until"} ${day(ends)} · ${days <= 0 ? "ends today" : `${days} ${days === 1 ? "day" : "days"} left`}`,
  };
}

/** Plan name, price and how long it runs */
export function PlanSummary({ plan }: { plan: PlanView }) {
  const st = standing(plan);
  const { days } = planDue(plan);
  const running = plan.access.state === "ok";
  // A full bar is a month or more left
  const pct = days === null ? 100 : Math.max(4, Math.min(100, Math.round((days / 30) * 100)));
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
          <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${running ? pct : 100}%` }} />
        </div>
        <p className={`mt-2 text-body ${running ? "text-muted" : "font-semibold text-danger"}`}>{st.line}</p>
      </div>
    </section>
  );
}

function FeatureTicks({ features, compare }: { features: Features; compare?: Features }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {FEATURE_KEYS.map((k) => {
        const on = features[k];
        const added = !!compare && on && !compare[k];
        return (
          <li key={k} className={`flex items-start gap-2 text-body ${on ? "text-ink" : "text-muted"}`}>
            <HugeiconsIcon icon={on ? Tick02Icon : Cancel01Icon} size={18} className={`mt-0.5 shrink-0 ${on ? "text-success" : "opacity-50"}`} aria-hidden />
            <span>
              {FEATURE_LABELS[k].label}
              {added && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand-strong">New</span>}
              <span className="sr-only">{on ? " included" : " not included"}</span>
            </span>
          </li>
        );
      })}
    </ul>
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
      <div className="mt-4">
        <FeatureTicks features={plan.features} />
      </div>
    </section>
  );
}

/** Everything paid to TableQR, newest first */
export function PlanPayments({ plan }: { plan: PlanView }) {
  if (!plan.payments.length) return null;
  const nameOf = (code: string | null) => plan.plans.find((p) => p.code === code)?.name;
  return (
    <section className={`${card} p-5`} aria-label="Your payments">
      <h2 className="font-display text-section font-bold text-ink">Your payments</h2>
      <ul className="mt-2 divide-y divide-line">
        {plan.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">
                {nameOf(p.planCode) ? `Upgrade to ${nameOf(p.planCode)} · ` : ""}
                {PERIOD[p.months] ?? `${p.months} months`} · {money(p.amountPaise)}
              </p>
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

function Sent({ upgrade }: { upgrade?: string }) {
  return (
    <section className={`${card} p-6 text-center`} aria-label="Pay TableQR">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={44} className="mx-auto text-success" aria-hidden />
      <h2 className="mt-3 font-display text-section font-bold text-ink">Thank you! We got your payment details</h2>
      <p className="mt-1 text-body text-muted">
        TableQR checks it in the bank and confirms it within 24 hours. {upgrade ? `The ${upgrade} plan starts as soon as it is confirmed.` : "Your plan updates as soon as it is confirmed."}
      </p>
    </section>
  );
}

/**
 * Choose how long, pay by UPI (QR or app link), then give the UPI reference. With a target plan
 * it pays for an upgrade at that plan's price.
 */
export function PayCard({ plan, upiId, target, onSent }: { plan: PlanView; upiId: string | null; target?: PlanOption; onSent?: () => void }) {
  const [months, setMonths] = useState<(typeof MONTHS)[number]>(1);
  const [method, setMethod] = useState<"upi" | "cash" | "bank">("upi");
  const [reference, setReference] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">(plan.waiting ? "sent" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Back from the UPI app: ask straight away for the reference
  const [askPaid, setAskPaid] = useState(false);
  const openedApp = useRef(false);
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible" && openedApp.current) {
        openedApp.current = false;
        setAskPaid(true);
      }
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  const perMonth = target?.monthlyPricePaise != null ? target.monthlyPricePaise * plan.fee.outletCount : plan.fee.totalPaise;
  const amount = perMonth * months;
  const refOk = method !== "upi" || isUtr(reference);
  const claim = async () => {
    if (!refOk) return setError("Enter the 12-digit UPI reference (UTR) from your UPI app.");
    setState("busy");
    setError(null);
    const r = await claimFeeAction({ months, method, reference, planCode: target?.code ?? null });
    if (r.ok) {
      setState("sent");
      onSent?.();
    } else {
      setError(r.error);
      setState("idle");
    }
  };
  const payUrl = upiId && amount > 0 ? upiPayUrl(upiId, amount / 100, `TableQR ${plan.outlet} ${target ? target.name : ""} ${months}m`) : null;
  const qr = useMemo(() => (payUrl ? qrSvg(payUrl, 220) : null), [payUrl]);

  if (state === "sent") return <Sent upgrade={target?.name} />;

  const utrInput = (id: string) => (
    <div className="space-y-1">
      <input
        id={id}
        value={reference}
        onChange={(e) => setReference(e.target.value.replace(method === "upi" ? /[^\d\s]/g : /[^\s\S]/g, "").slice(0, 60))}
        placeholder={method === "upi" ? "12-digit UPI reference (UTR)" : "Note (optional)"}
        aria-label={method === "upi" ? "UPI reference number" : "Note"}
        inputMode={method === "upi" ? "numeric" : "text"}
        className={`h-12 w-full rounded-input border bg-surface px-3 text-body text-ink placeholder:text-muted ${focus} ${reference && !refOk ? "border-danger" : "border-line"}`}
      />
      {method === "upi" && <p className="text-caption text-muted">In GPay, PhonePe or Paytm open this payment; copy the UPI reference / UTR / transaction ID.</p>}
    </div>
  );

  return (
    <section className={`${card} overflow-hidden`} aria-label="Pay TableQR">
      <div className="p-5">
        <h2 className="font-display text-section font-bold text-ink">{target ? `Pay for ${target.name}` : "Pay TableQR"}</h2>
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
            <p className="text-caption text-muted">{money(perMonth)} × {PERIOD[months]}</p>
          </div>
          <p className="font-display text-title font-bold text-ink tabular">{money(amount)}</p>
        </div>

        {payUrl ? (
          <div className="mt-5 flex flex-col items-center text-center">
            {qr && <div className="size-48 rounded-input border border-line bg-white p-2 shadow-sm" role="img" aria-label={`UPI QR code to pay ${money(amount)}`} dangerouslySetInnerHTML={{ __html: qr }} />}
            <p className="mt-2 text-caption text-muted">Scan with any UPI app</p>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard?.writeText(upiId!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-mono text-caption text-ink hover:bg-ink/5 ${focus}`}
            >
              {upiId}
              <HugeiconsIcon icon={Copy01Icon} size={14} aria-hidden />
              <span className="sr-only">Copy UPI ID</span>
            </button>
            {copied && <span role="status" className="mt-1 text-caption text-success">Copied</span>}
            <a
              href={payUrl}
              onClick={() => {
                openedApp.current = true;
                setTimeout(() => setAskPaid(true), 4000);
              }}
              className={`mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-cta bg-brand px-5 text-button font-semibold text-brand-on hover:bg-brand-hover ${focus}`}
            >
              <HugeiconsIcon icon={SmartPhone01Icon} size={18} aria-hidden />
              Pay {money(amount)} in UPI app
            </a>
            <p className="mt-1.5 text-caption text-muted">On a phone this opens GPay, PhonePe or Paytm</p>
          </div>
        ) : (
          <p className="mt-4 rounded-input border border-line px-3 py-2.5 text-body text-muted">Pay TableQR by UPI, cash or bank as agreed, then tell us below.</p>
        )}
      </div>

      {askPaid && method === "upi" && (
        <div role="alertdialog" aria-label="Did the payment go through?" className="space-y-3 border-t border-brand-border bg-brand-soft p-5">
          <div>
            <p className="font-display text-section font-bold text-ink">Payment done?</p>
            <p className="text-body text-muted">Paste the UPI reference of this {money(amount)} payment.</p>
          </div>
          {utrInput("utr-quick")}
          <div className="flex gap-2">
            <button type="button" disabled={state === "busy" || !refOk} onClick={() => void claim()} className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-cta bg-brand px-4 text-button font-semibold text-brand-on disabled:opacity-50 ${focus}`}>
              {state === "busy" ? "Sending…" : "Yes, I have paid"}
            </button>
            <button type="button" onClick={() => setAskPaid(false)} className={`inline-flex min-h-12 items-center justify-center rounded-cta border border-line px-4 text-button font-semibold text-ink ${focus}`}>
              Not yet
            </button>
          </div>
          {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        </div>
      )}
      {!askPaid && (
        <form
          className="space-y-3 border-t border-line bg-ink/[0.02] p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void claim();
          }}
        >
          <div>
            <p className="text-body font-semibold text-ink">Paid already?</p>
            <p className="text-caption text-muted">Tell TableQR. We check it in the bank and confirm it within 24 hours.</p>
          </div>
          <div role="radiogroup" aria-label="How you paid" className="flex gap-2">
            {(["upi", "cash", "bank"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => {
                  setMethod(m);
                  setError(null);
                }}
                className={`min-h-10 flex-1 rounded-input border text-caption font-semibold ${focus} ${method === m ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink hover:border-ink/40"}`}
              >
                {METHOD[m]}
              </button>
            ))}
          </div>
          {utrInput("utr")}
          <button type="submit" disabled={state === "busy" || !refOk} className={`inline-flex min-h-12 w-full items-center justify-center rounded-cta bg-ink px-5 text-button font-semibold text-paper disabled:opacity-50 ${focus}`}>
            {state === "busy" ? "Sending…" : `I have paid ${money(amount)}`}
          </button>
          {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        </form>
      )}
    </section>
  );
}

/** Paid and not due yet: a calm card, with paying in advance one tap away */
export function PayOrPaid({ plan, upiId }: { plan: PlanView; upiId: string | null }) {
  const { due } = planDue(plan);
  const [open, setOpen] = useState(false);
  if (due || open || plan.waiting) return <PayCard plan={plan} upiId={upiId} />;
  return (
    <section className={`${card} p-6 text-center`} aria-label="Payments">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={40} className="mx-auto text-success" aria-hidden />
      <h2 className="mt-2 font-display text-section font-bold text-ink">You are all paid</h2>
      <p className="mt-1 text-body text-muted">Paid until {day(plan.access.endsAt)}. We will remind you a week before it ends.</p>
      <button type="button" onClick={() => setOpen(true)} className={`mt-4 inline-flex min-h-11 items-center rounded-cta border border-line px-4 text-button font-semibold text-ink hover:bg-ink/5 ${focus}`}>
        Pay in advance
      </button>
    </section>
  );
}

const STEPS = ["Choose plan", "How long", "Pay", "Done"] as const;

/** Upgrade in steps: pick a bigger plan, see what it adds, pay, and TableQR switches it on */
export function UpgradePlans({ plan, upiId }: { plan: PlanView; upiId: string | null }) {
  const currentIndex = plan.plans.findIndex((p) => p.code === plan.planCode);
  const currentPrice = plan.plans[currentIndex]?.monthlyPricePaise ?? plan.fee.perOutletPaise;
  // Bigger plans only: a smaller plan or a custom setup is arranged with TableQR
  const options = plan.plans.filter((p, i) => p.code !== plan.planCode && (currentIndex === -1 || i > currentIndex));
  const [chosen, setChosen] = useState<PlanOption | null>(null);
  const [sent, setSent] = useState(false);
  if (!options.length) return null;
  const step = sent ? 3 : chosen ? 2 : 0;

  return (
    <section className={`${card} p-5`} aria-label="Upgrade your plan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-section font-bold text-ink">Upgrade your plan</h2>
        <ol className="flex flex-wrap items-center gap-1.5 text-caption" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} className={`flex items-center gap-1.5 ${i <= step ? "font-semibold text-ink" : "text-muted"}`}>
              <span className={`grid size-5 place-items-center rounded-full text-[11px] ${i < step ? "bg-success text-white" : i === step ? "bg-brand text-brand-on" : "bg-ink/10"}`}>{i < step ? "✓" : i + 1}</span>
              {s}
              {i < STEPS.length - 1 && <span className="text-muted" aria-hidden="true">›</span>}
            </li>
          ))}
        </ol>
      </div>

      {!chosen && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {options.map((p) => {
            const extra = p.monthlyPricePaise !== null && currentPrice !== null ? p.monthlyPricePaise - currentPrice : null;
            return (
              <div key={p.code} className="flex flex-col rounded-input border border-line p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-display text-section font-bold text-ink">{p.name}</p>
                  <p className="font-display text-section font-bold text-ink tabular">{p.monthlyPricePaise === null ? "Custom" : money(p.monthlyPricePaise)}<span className="text-caption font-normal text-muted">{p.monthlyPricePaise === null ? "" : " / month"}</span></p>
                </div>
                {extra !== null && extra > 0 && <p className="text-caption text-muted">{money(extra)} more per outlet each month</p>}
                <p className="mt-2 text-caption text-muted">Tables {p.features.maxTables ?? "no limit"} · Staff {p.features.maxStaff ?? "no limit"}</p>
                <ul className="mt-2 flex-1 space-y-1">
                  {FEATURE_KEYS.filter((k) => p.features[k] && !plan.features[k]).map((k) => (
                    <li key={k} className="flex items-start gap-1.5 text-body text-ink"><HugeiconsIcon icon={Tick02Icon} size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />{FEATURE_LABELS[k].label}</li>
                  ))}
                </ul>
                {p.monthlyPricePaise === null ? (
                  <p className="mt-3 text-caption text-muted">Set up with TableQR. Call or WhatsApp us.</p>
                ) : (
                  <button type="button" onClick={() => setChosen(p)} className={`mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-cta bg-ink px-4 text-button font-semibold text-paper ${focus}`}>
                    Choose {p.name}
                    <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {chosen && !sent && (
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <div>
            <p className="text-body text-muted">
              From <span className="font-semibold text-ink">{plan.planName}</span> to <span className="font-semibold text-ink">{chosen.name}</span>. You get:
            </p>
            <div className="mt-3">
              <FeatureTicks features={chosen.features} compare={plan.features} />
            </div>
            <p className="mt-3 text-caption text-muted">Tables {chosen.features.maxTables ?? "no limit"} · Staff logins {chosen.features.maxStaff ?? "no limit"}</p>
            <button type="button" onClick={() => setChosen(null)} className={`mt-4 text-body font-semibold text-muted underline underline-offset-4 ${focus}`}>← Choose another plan</button>
          </div>
          <PayCard plan={{ ...plan, waiting: false }} upiId={upiId} target={chosen} onSent={() => setSent(true)} />
        </div>
      )}

      {sent && chosen && (
        <div className="mt-4">
          <Sent upgrade={chosen.name} />
        </div>
      )}
    </section>
  );
}

/** Only the payment card, for the paused screen */
export function PlanPanel({ plan, upiId }: { plan: PlanView; upiId: string | null; compact?: boolean }) {
  return <PayCard plan={plan} upiId={upiId} />;
}
