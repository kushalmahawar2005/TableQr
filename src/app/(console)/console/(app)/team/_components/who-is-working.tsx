"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DutyRow } from "@/server/staff/duty";

// Who is on the floor right now: shift status each person set in the staff app, and whether
// their app is open ("online now"). Refreshes every minute.

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

export function WhoIsWorking({ rows }: { rows: DutyRow[] }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); router.refresh(); }, 60_000);
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
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate font-semibold text-ink">
                <span className={`size-2 shrink-0 rounded-full ${r.online ? "bg-[var(--state-available)]" : "bg-ink/20"}`} aria-hidden="true" />
                {r.name}
              </p>
              <p className="text-xs text-muted">
                {r.roles.map((x) => ROLE[x] ?? x).join(", ")} · {r.online ? "app open" : r.lastSeenAt ? `last seen ${ago(now - r.lastSeenAt)}` : "never opened the app"}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[r.status]}`} title={r.since ? `Since ${ago(now - r.since)}` : undefined}>{LABEL[r.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
