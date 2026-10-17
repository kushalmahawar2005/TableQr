"use client";

import { useState } from "react";
import { requestPlanChangeAction } from "./plan-request-actions";

/** "Ask TableQR to unlock this": sends a request the platform admin handles by hand */
export function RequestUpgrade({ feature, asked }: { feature: string; asked: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">(asked ? "sent" : "idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "sent") return <p role="status" className="mt-5 text-body font-semibold text-[var(--state-available-text)]">Request sent. TableQR will call you to set it up.</p>;
  return (
    <div className="mt-5">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await requestPlanChangeAction({ feature });
          if (r.ok) setState("sent");
          else { setError(r.error); setState("error"); }
        }}
        className="inline-flex min-h-11 items-center rounded-cta bg-ink px-5 text-button font-semibold text-white disabled:opacity-60"
      >
        {state === "busy" ? "Sending…" : "Ask TableQR to unlock this"}
      </button>
      {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
    </div>
  );
}

export const RENEW_NOTE = "Please renew our plan";

/** Asks TableQR to renew the plan; the platform admin records the fees or extends the trial */
export function RenewButton({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "sent") return <span role="status" className="font-semibold">Request sent. TableQR will call you.</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await requestPlanChangeAction({ note: RENEW_NOTE });
          if (r.ok) setState("sent");
          else { setError(r.error); setState("error"); }
        }}
        className={`inline-flex items-center rounded-cta font-semibold disabled:opacity-60 ${compact ? "min-h-9 bg-white/90 px-3 text-caption text-ink" : "min-h-11 bg-ink px-5 text-button text-white"}`}
      >
        {state === "busy" ? "Sending…" : "Ask TableQR to renew"}
      </button>
      {error && <span role="alert" className="text-caption">{error}</span>}
    </span>
  );
}
