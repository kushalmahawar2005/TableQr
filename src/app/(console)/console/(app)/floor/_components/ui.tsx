"use client";

import {
  AlertCircleIcon,
  Calendar03Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Invoice01Icon,
  LockIcon,
  SparklesIcon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useRef, type ReactNode } from "react";

// Staff Foundation pieces for S1: calm, dense, readable from a few feet away. Every table state
// is a colour plus a word and an icon, never colour alone.

export const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export const btn = `inline-flex min-h-11 items-center justify-center gap-2 rounded-input px-3.5 text-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
export const btnPrimary = `${btn} bg-ink text-white hover:bg-ink/90`;
export const btnLine = `${btn} border border-line bg-surface text-ink hover:border-ink/40`;
export const btnQuiet = `${btn} text-ink hover:bg-ink/5`;
export const btnDanger = `${btn} border border-danger/30 bg-surface text-danger hover:bg-[var(--state-seated-soft)]`;

export const STATE_STYLE: Record<string, { tone: string; soft: string; text: string; icon: IconSvgElement }> = {
  available: { tone: "var(--state-available)", soft: "var(--state-available-soft)", text: "var(--state-available-text)", icon: CheckmarkCircle02Icon },
  held: { tone: "var(--state-held)", soft: "var(--state-held-soft)", text: "var(--state-held-text)", icon: Clock01Icon },
  reserved: { tone: "var(--state-reserved)", soft: "var(--state-reserved-soft)", text: "var(--state-reserved-text)", icon: Calendar03Icon },
  seated: { tone: "var(--state-seated)", soft: "var(--state-seated-soft)", text: "var(--state-seated-text)", icon: UserGroupIcon },
  bill_requested: { tone: "var(--state-bill)", soft: "var(--state-bill-soft)", text: "var(--state-bill-text)", icon: Invoice01Icon },
  paid: { tone: "var(--state-paid)", soft: "var(--state-paid-soft)", text: "var(--state-paid-text)", icon: CheckmarkCircle02Icon },
  needs_cleaning: { tone: "var(--state-cleaning)", soft: "var(--state-cleaning-soft)", text: "var(--state-cleaning-text)", icon: SparklesIcon },
  blocked: { tone: "var(--state-blocked)", soft: "var(--state-blocked-soft)", text: "var(--state-blocked-text)", icon: LockIcon },
};

export function StateChip({ state, label, size = "md" }: { state: string; label: string; size?: "sm" | "md" | "lg" }) {
  const st = STATE_STYLE[state] ?? STATE_STYLE.available;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold ${size === "sm" ? "px-1.5 py-px text-label" : size === "lg" ? "gap-1.5 px-3 py-1 text-body" : "px-2 py-0.5 text-caption"}`}
      style={{ borderColor: st.tone, background: st.soft, color: st.text }}
    >
      <HugeiconsIcon icon={st.icon} size={size === "sm" ? 11 : size === "lg" ? 16 : 13} aria-hidden />
      {label}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const tones = {
    neutral: "bg-ink/[0.06] text-ink",
    good: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
    warn: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
    bad: "bg-[var(--state-seated-soft)] text-danger",
    info: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold ${tones[tone]}`}>{children}</span>;
}

/** Modal dialog on the native <dialog>: focus stays inside, Escape closes */
export function Dialog({ title, onClose, children, closeLabel, wide = false }: { title: string; onClose: () => void; children: ReactNode; closeLabel: string; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      try {
        d.showModal();
      } catch {
        // already open
      }
    }
    return () => {
      try {
        d?.close();
      } catch {
        // gone
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="s1-dialog-title"
      className={`m-auto w-[calc(100%-32px)] ${wide ? "max-w-xl" : "max-w-md"} rounded-card border border-line bg-surface p-0 text-ink shadow-[var(--shadow-modal)] backdrop:bg-black/55`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 id="s1-dialog-title" className="font-display text-section font-bold">
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label={closeLabel} className={`grid size-11 place-items-center rounded-full text-muted hover:bg-ink/5 ${focus}`}>
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />
        </button>
      </div>
      <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

export function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-input border border-danger/25 bg-[var(--state-seated-soft)] px-3 py-2 text-body font-semibold text-danger">
      <HugeiconsIcon icon={AlertCircleIcon} size={18} className="mt-px shrink-0" aria-hidden />
      {text}
    </p>
  );
}

export function Stepper({ value, onChange, min, max, label }: { value: number; onChange: (n: number) => void; min: number; max: number; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="−1" className={`${btnLine} w-12 text-title`}>
        −
      </button>
      <output className="w-14 text-center font-display text-title font-bold tabular">{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="+1" className={`${btnLine} w-12 text-title`}>
        +
      </button>
    </div>
  );
}

export const PersonIcon = UserIcon;
