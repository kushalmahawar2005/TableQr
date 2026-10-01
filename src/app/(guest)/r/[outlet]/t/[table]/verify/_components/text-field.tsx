"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

/** Guest input: 52 tall, 16px text (no zoom on iPhone), quiet border, brand ring on focus */
export const fieldClass = (invalid: boolean) =>
  `h-13 w-full rounded-input border bg-surface px-3.5 text-section text-ink outline-none transition-[border-color,box-shadow] duration-150 ease-natural placeholder:text-muted/70 disabled:bg-paper disabled:text-muted ${
    invalid
      ? "border-danger focus:shadow-[0_0_0_3px_var(--state-seated-soft)]"
      : "border-line focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]"
  }`;

/** Labelled text input with a helper line that turns into the error when there is one */
export const TextField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { id: string; label: string; help?: string; error?: string }
>(function TextField({ id, label, help, error, ...input }, ref) {
  const noteId = `${id}-note`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-caption font-semibold text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={error || help ? noteId : undefined}
        className={fieldClass(!!error)}
        {...input}
      />
      {(error || help) && (
        <p id={noteId} className={`mt-1.5 text-caption ${error ? "text-danger" : "text-muted"}`}>
          {error ?? help}
        </p>
      )}
    </div>
  );
});
