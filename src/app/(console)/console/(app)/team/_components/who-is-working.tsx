"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DutyRow, DutyStatus } from "@/server/staff/duty";
import { setDutyAction } from "../actions";

// Who is on the floor right now: each person's shift, set here by the manager or owner, and
// whether their staff app is open ("online now"). Refreshes every 15 seconds.

const LABEL = { on: "On duty", break: "On break", off: "Off duty" } as const;
const TONE = {
  on: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
  break: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  off: "bg-ink/10 text-muted",
} as const;
const ROLE: Record<string, string> = { manager: "Manager", waiter: "Waiter", host: "Host", cashier: "Cashier", kitchen: "Kitchen" };

function ago(ms: number) {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export function WhoIsWorking({ rows, canChange = false, onSelect }: { rows: DutyRow[]; canChange?: boolean; onSelect?: (id: string) => void }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A tap shows at once and holds for a few seconds while the page catches up; a failed save
  // drops it so the real status shows again
  const [picked, setPicked] = useState<Record<string, { status: DutyStatus; at: number }>>({});
  const change = (id: string, status: DutyStatus) => {
    setPicked((p) => ({ ...p, [id]: { status, at: Date.now() } }));
    start(async () => {
      setError(null);
      const r = await setDutyAction(id, status);
      if (!r.ok) {
        setError(r.message);
        setPicked((p) => { const next = { ...p }; delete next[id]; return next; });
      }
      router.refresh();
    });
  };
  rows = rows.map((r) => (picked[r.id] && now - picked[r.id].at < 20_000 ? { ...r, status: picked[r.id].status } : r));
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); router.refresh(); }, 15_000);
    return () => clearInterval(t);
  }, [router]);
  const onDuty = rows.filter((r) => r.status === "on");
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="who-working" className="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="who-working" className="font-display text-section font-bold text-ink">Who&apos;s working now</h2>
        <p className="text-sm text-muted">{onDuty.length} on duty · {onDuty.filter((r) => r.online).length} with the app open</p>
      </div>
      {canChange && <p className="mt-1 text-xs text-muted">Set who is on duty. Only staff on duty get the alerts for new requests.</p>}
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{error}</p>}
      <ul className="mt-3 grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
            <div className="min-w-0">
              {onSelect ? <button type="button" onClick={() => onSelect(r.id)} className="flex items-center gap-2 truncate rounded-lg text-left font-semibold text-ink outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand">
                <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-[var(--state-available-soft)] text-sm font-bold text-[var(--state-available-text)]">{r.name.trim().slice(0, 1).toUpperCase()}<span className={`absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-surface ${r.online ? "bg-[var(--state-available)]" : "bg-ink/30"}`} aria-hidden="true" /></span>
                {r.name}
              </button> : <p className="flex items-center gap-2 truncate font-semibold text-ink"><span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-[var(--state-available-soft)] text-sm font-bold text-[var(--state-available-text)]">{r.name.trim().slice(0, 1).toUpperCase()}<span className={`absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-surface ${r.online ? "bg-[var(--state-available)]" : "bg-ink/30"}`} aria-hidden="true" /></span>{r.name}</p>}
              <p className="text-xs text-muted">
                {r.roles.map((x) => ROLE[x] ?? x).join(", ")} · {r.online ? "app open" : r.lastSeenAt ? `last seen ${ago(now - r.lastSeenAt)}` : "never opened the app"}
              </p>
            </div>
            {canChange ? (
              <div role="radiogroup" aria-label={`Shift for ${r.name}`} className="flex shrink-0 gap-1">
                {(["on", "break", "off"] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={r.status === v} onClick={() => r.status !== v && change(r.id, v)} className={`min-h-9 rounded-full px-2.5 text-xs font-semibold disabled:opacity-60 ${r.status === v ? TONE[v] : "text-muted hover:bg-ink/5 hover:text-ink"}`}>
                    {v === "on" ? "On" : v === "break" ? "Break" : "Off"}
                  </button>
                ))}
              </div>
            ) : (
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[r.status]}`} title={r.since ? `Since ${ago(now - r.since)}` : undefined}>{LABEL[r.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
