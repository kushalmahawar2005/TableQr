"use client";

import { ArrowRight02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useActionState, useMemo } from "react";
import { startOrJoin } from "../actions";

/**
 * The one primary action on G1: Start ordering or Join Table T12. A second tap while the first
 * is in flight does nothing, and the label says what is happening.
 */
export function StartCta({
  outletCode,
  shortCode,
  label,
  ariaLabel,
  pendingLabel,
  askStaffText,
  failedText,
  preview,
}: {
  outletCode: string;
  shortCode: string;
  label: string;
  ariaLabel: string;
  pendingLabel: string;
  askStaffText: string;
  failedText: string;
  preview?: boolean;
}) {
  const bound = useMemo(() => startOrJoin.bind(null, outletCode, shortCode), [outletCode, shortCode]);
  const [state, action, pending] = useActionState(bound, null);

  if (state?.error === "ask_staff") {
    return (
      <p role="status" className="rounded-cta border border-line bg-surface px-4 py-4 text-center text-body font-semibold text-ink">
        {askStaffText}
      </p>
    );
  }

  return (
    <form action={preview ? undefined : action}>
      <PrimaryButton
        label={pending ? pendingLabel : label}
        ariaLabel={pending ? pendingLabel : ariaLabel}
        busy={pending}
        type={preview ? "button" : "submit"}
        arrow={!pending}
      />
      {state?.error === "failed" && (
        <p role="alert" className="mt-3 text-center text-caption text-danger">
          {failedText}
        </p>
      )}
    </form>
  );
}

export function PrimaryButton({
  label,
  ariaLabel,
  busy,
  disabled,
  type = "submit",
  arrow,
}: {
  label: string;
  ariaLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  /** Trailing arrow: this button moves the guest forward */
  arrow?: boolean;
}) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={busy || disabled}
      className="flex min-h-14 w-full items-center justify-center gap-2 rounded-cta bg-brand px-5 py-3 text-center text-button font-semibold text-brand-on transition-[transform,background-color,opacity] duration-100 ease-natural hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] active:bg-brand-pressed disabled:cursor-default disabled:opacity-60 disabled:active:scale-100"
    >
      {busy && <HugeiconsIcon icon={Loading03Icon} size={20} className="animate-spin" aria-hidden />}
      {label}
      {arrow && <HugeiconsIcon icon={ArrowRight02Icon} size={20} strokeWidth={2} className="shrink-0" aria-hidden />}
    </button>
  );
}
