import type { Features } from "@/lib/plan-features";
import { ArrowRight, CheckCircle2, Clock, Lock, Receipt, UtensilsCrossed, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardData } from "@/server/staff/dashboard";
import { focusRing, money, timeIn } from "./dashboard-shared";

type Alert = { key: string; tone: "bad" | "warn" | "info"; icon: typeof Clock; text: ReactNode; href?: string; linkLabel?: string };

/** The alerts in display order; exported for the tests */
export function alertsOf(data: DashboardData, features?: Features): Alert[] {
  const a = data.alerts;
  const out: Alert[] = [];
  for (const b of (features && !features.dineIn ? [] : a.slowBills)) {
    out.push({ key: `bill-${b.sessionId}`, tone: "bad", icon: Receipt, text: <><strong>{b.tableCode}</strong> · bill requested {b.waitedMinutes} min ago</>, href: "/console/floor", linkLabel: "Floor" });
  }
  for (const r of (features && !features.reservations ? [] : a.late)) {
    out.push({
      key: `late-${r.id}`,
      tone: r.noShowEligible ? "bad" : "warn",
      icon: Clock,
      text: (
        <>
          <strong>{r.name ?? "Guest"}</strong> · {r.partySize} at {timeIn(r.startAt, data.timezone)} · {r.lateMinutes} min late
          {r.noShowEligible && " · No-show eligible"}
        </>
      ),
      href: "/console/reservations",
      linkLabel: "Reservations",
    });
  }
  if (a.soldOut > 0) out.push({ key: "sold-out", tone: "warn", icon: UtensilsCrossed, text: <><strong>{a.soldOut}</strong> {a.soldOut === 1 ? "item" : "items"} sold out</>, href: "/console/menu", linkLabel: "Menu" });
  if (a.pendingRefunds.count > 0) {
    out.push({ key: "refunds", tone: "info", icon: Wallet, text: <><strong>{a.pendingRefunds.count}</strong> pending {a.pendingRefunds.count === 1 ? "refund" : "refunds"} · {money(a.pendingRefunds.paise)}</> });
  }
  if (a.lowStock.length > 0) {
    out.push({ key: "low-stock", tone: "warn", icon: UtensilsCrossed, text: <><strong>{a.lowStock.length}</strong> running low: {a.lowStock.slice(0, 3).join(", ")}{a.lowStock.length > 3 ? "…" : ""}</>, href: "/console/inventory", linkLabel: "Inventory" });
  }
  if ((!features || features.dineIn) && a.blockedTables > 0) out.push({ key: "blocked", tone: "info", icon: Lock, text: <><strong>{a.blockedTables}</strong> {a.blockedTables === 1 ? "table" : "tables"} blocked</>, href: "/console/floor", linkLabel: "Floor" });
  return out;
}

const TONE_CLASSES = {
  bad: "bg-rose-50 text-rose-700 border-rose-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  info: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

/**
 * Compact priority strip (spec §18): with alerts it lists them; when calm it is a single line,
 * never a whole card spent on "everything is fine".
 */
export function NeedsAttention({ data, features }: { data: DashboardData; features?: Features }) {
  const alerts = alertsOf(data, features);
  if (alerts.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-2.5 text-[13px] font-medium text-muted" role="status">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-700" aria-hidden="true" />
        Nothing needs your attention
        <span className="sr-only"> — all good right now.</span>
      </p>
    );
  }
  return (
    <section className="rounded-card border border-line bg-surface p-4" aria-label="Needs Attention">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold text-ink">Needs Attention</h2>
        <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-bold text-terracotta tabular">{alerts.length}</span>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {alerts.map((al) => {
          const Icon = al.icon;
          return (
            <li key={al.key} className="flex min-w-0 items-center justify-between gap-2 rounded-input border border-line bg-surface px-3.5 py-2">
              <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink">
                <span className={`grid size-7 shrink-0 place-items-center rounded-lg border ${TONE_CLASSES[al.tone]}`}>
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 break-words font-medium">{al.text}</span>
              </span>
              {al.href && (
                <Link href={al.href} className={`inline-flex min-h-10 shrink-0 items-center gap-1 px-1 text-xs font-semibold text-forest hover:underline underline-offset-4 ${focusRing}`}>
                  {al.linkLabel}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
