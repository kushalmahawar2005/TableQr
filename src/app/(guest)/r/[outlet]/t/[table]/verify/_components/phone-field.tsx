"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { forwardRef } from "react";
import { COUNTRIES, countryByIso, formatIndianMobile, normaliseIndianMobile } from "@/domain/phone";
import type { Lang } from "@/lib/i18n";
import { fieldClass } from "./text-field";

/** Mobile number: a light country chip (native select underneath) and the 10-digit number */
export const PhoneField = forwardRef<
  HTMLInputElement,
  {
    id: string;
    lang: Lang;
    label: string;
    countryLabel: string;
    country: string;
    digits: string;
    onCountry: (iso: string) => void;
    onDigits: (digits: string) => void;
    onBlur?: () => void;
    disabled?: boolean;
    error?: string;
  }
>(function PhoneField({ id, lang, label, countryLabel, country, digits, onCountry, onDigits, onBlur, disabled, error }, ref) {
  const c = countryByIso(country) ?? COUNTRIES[0];
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-caption font-semibold text-ink">
        {label}
      </label>
      {/* The number drops below the country chip when large text leaves no room beside it */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex h-13 shrink-0 items-center gap-1.5 rounded-input border border-line bg-surface px-3 focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <span aria-hidden className="text-section font-semibold tabular text-ink">
            {c.dial}
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} className="text-muted" aria-hidden />
          <select
            aria-label={countryLabel}
            value={c.iso}
            disabled={disabled}
            onChange={(e) => onCountry(e.target.value)}
            className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-default"
          >
            {COUNTRIES.map((o) => (
              <option key={o.iso} value={o.iso}>
                {o.flag} {o.name[lang]} {o.dial}
              </option>
            ))}
          </select>
        </div>
        <input
          ref={ref}
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          // 10 digits plus the space after the fifth
          maxLength={c.iso === "IN" ? 11 : 15}
          value={c.iso === "IN" ? formatIndianMobile(digits) : digits}
          onChange={(e) => onDigits(c.iso === "IN" ? normaliseIndianMobile(e.target.value) : e.target.value.replace(/\D/g, "").slice(0, 14))}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${fieldClass(!!error)} w-auto min-w-[11ch] flex-1 tabular`}
        />
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
