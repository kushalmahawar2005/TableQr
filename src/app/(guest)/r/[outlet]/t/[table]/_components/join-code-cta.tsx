"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { Lang } from "@/lib/i18n";
import { g1Copy, type G1Copy } from "../_copy";
import { joinWithCode, type CodeResult } from "../actions";
import { PrimaryButton } from "./start-cta";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Host-confirmed mode: Join Table T12 opens a small sheet for the table's 4-digit code. The
 * server checks the code; this only keeps the field to digits. Not phone verification (G2).
 */
export function JoinCodeCta({
  outletCode,
  shortCode,
  label,
  lang,
  preview,
}: {
  outletCode: string;
  shortCode: string;
  label: string;
  lang: Lang;
  preview?: boolean;
}) {
  const c = g1Copy[lang].code;
  const failedText = g1Copy[lang].actionError;
  const [open, setOpen] = useState(false);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  return (
    <>
      <PrimaryButton type="button" label={label} arrow onClick={() => !preview && setOpen(true)} />
      {open && <CodeSheet outletCode={outletCode} shortCode={shortCode} c={c} failedText={failedText} online={online} onClose={() => setOpen(false)} />}
    </>
  );
}

function CodeSheet({
  outletCode,
  shortCode,
  c,
  failedText,
  online,
  onClose,
}: {
  outletCode: string;
  shortCode: string;
  c: G1Copy["code"];
  failedText: string;
  online: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<CodeResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Already open
      }
    }
    return () => {
      try {
        dialog?.close();
      } catch {
        // Already closed
      }
    };
  }, []);

  const submit = () => {
    if (pending || !online) return;
    if (code.length !== 4) {
      setResult({ error: "invalid" });
      return;
    }
    startTransition(async () => {
      try {
        const res = await joinWithCode(outletCode, shortCode, code);
        // A right code redirects to the menu; "changed" re-renders the table's current state
        if (res.error === "changed") onClose();
        else setResult(res);
      } catch {
        setResult({ error: "failed" });
      }
    });
  };

  const error = !online
    ? c.offline
    : result?.error === "invalid"
      ? c.invalid
      : result?.error === "wrong"
        ? c.wrong(result.attemptsLeft)
        : result?.error === "locked"
          ? c.locked(Math.ceil(result.retryIn / 60))
          : result?.error === "failed"
            ? failedText
            : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby="g1-code-title"
      aria-describedby="g1-code-help"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 mx-auto w-full max-w-[480px] animate-sheet rounded-t-sheet border-t border-line bg-paper px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-ink shadow-[var(--shadow-sheet)] backdrop:bg-ink/40"
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden />
      <div className="flex items-start gap-3">
        <h2 id="g1-code-title" className="min-w-0 flex-1 pt-2 font-display text-title font-bold">
          {c.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label={c.close}
          className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />
        </button>
      </div>
      <p id="g1-code-help" className="mt-1 text-body text-muted">
        {c.helper}
      </p>
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="g1-code" className="sr-only">
          {c.label}
        </label>
        <input
          id="g1-code"
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={4}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
            setResult(null);
          }}
          aria-invalid={result && result.error !== "failed" ? true : undefined}
          aria-describedby={error ? "g1-code-error" : undefined}
          placeholder="••••"
          className={`h-16 w-full rounded-input border bg-surface text-center font-display text-display font-bold tracking-[0.5em] text-ink tabular outline-none placeholder:text-line focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] ${
            error && online ? "border-danger" : "border-line"
          }`}
        />
        <p id="g1-code-error" role="alert" className="mt-2 min-h-5 text-center text-caption font-semibold text-danger">
          {error}
        </p>
        <div className="mt-2">
          <PrimaryButton label={pending ? c.joining : c.join} busy={pending} disabled={!online || code.length !== 4 || result?.error === "locked"} />
        </div>
      </form>
    </dialog>
  );
}
