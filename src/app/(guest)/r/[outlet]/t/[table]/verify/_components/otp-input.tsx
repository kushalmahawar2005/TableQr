"use client";

import { forwardRef, useState } from "react";
import { normaliseCode, OTP } from "@/domain/otp";

/**
 * The 4-digit code: one real input (numeric keyboard, SMS auto-fill, paste, screen readers) laid
 * over four drawn cells. Typing, deleting and pasting all edit that one input.
 */
export const OtpInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (code: string) => void;
    label: string;
    disabled?: boolean;
    invalid?: boolean;
    /** Changes on each wrong code to replay the single shake */
    shakeKey?: number;
    describedBy?: string;
    /** Dev preview: draw the cells as if focused */
    showFocus?: boolean;
  }
>(function OtpInput({ value, onChange, label, disabled, invalid, shakeKey = 0, describedBy, showFocus }, ref) {
  const [focused, setFocused] = useState(false);
  const active = focused || showFocus ? Math.min(value.length, OTP.length - 1) : -1;

  return (
    <div className="relative max-w-[352px]">
      <div key={shakeKey} aria-hidden className={`grid grid-cols-4 gap-3 ${shakeKey ? "animate-shake" : ""}`}>
        {Array.from({ length: OTP.length }, (_, i) => {
          const digit = value[i];
          const isActive = i === active && !disabled;
          return (
            <div
              key={i}
              className={`grid h-16 place-items-center rounded-cta border bg-surface text-[26px] leading-8 font-semibold tabular text-ink transition-[border-color,box-shadow] duration-150 ease-natural ${
                disabled
                  ? "border-line bg-paper text-muted"
                  : invalid
                    ? "border-danger"
                    : isActive
                      ? "border-brand shadow-[0_0_0_2px_var(--brand-soft)]"
                      : "border-line"
              }`}
            >
              {digit ?? (disabled ? <span className="text-line">–</span> : isActive ? <span className="h-7 w-0.5 animate-pulse rounded-full bg-ink/80" /> : null)}
            </div>
          );
        })}
      </div>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={OTP.length * 2}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(normaliseCode(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Taps land anywhere on the row; editing always continues from the end
        onClick={(e) => {
          const el = e.currentTarget;
          if (el.selectionStart === el.selectionEnd) el.setSelectionRange(el.value.length, el.value.length);
        }}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-[16px] text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-default"
      />
    </div>
  );
});
