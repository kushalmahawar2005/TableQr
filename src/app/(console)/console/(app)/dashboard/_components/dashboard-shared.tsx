import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { deltaLabel, deltaOf } from "@/domain/dashboard";

// Shared building blocks for the owner dashboard. The design tokens in src/app/globals.css are
// the source of truth; this file only holds the small helpers every dashboard panel needs.

// Legacy export kept for compatibility (fixtures and older imports reference it). New code must
// consume the globals.css tokens through Tailwind classes, not these constants.
export const THEME = {
  forestGreen: "#103B2C",
  forestGreenHover: "#174D39",
  warmCream: "#F7F5EF",
  surface: "#FFFFFF",
  terracotta: "#D86B45",
  softSage: "#DDE8DA",
  primaryText: "#17251F",
  mutedText: "#768078",
  border: "#E9E5DD",
} as const;

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";
export const cardClass = "rounded-card border border-line bg-surface p-5";
export const viewAllClass = `inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper ${focusRing}`;

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
/** ₹ with Indian grouping; paise only when there are any, so an amount is never rounded away */
export const money = (paise: number) =>
  `₹${paise % 100 === 0 ? rupees.format(paise / 100) : (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const timeIn = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);

/** "Wednesday, 21 October" for an outlet date; formatted at UTC noon so no time zone can move the day */
export const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...opts }).format(new Date(`${date}T12:00:00Z`));

/** Human-readable time ago: "2 min ago", "1 hour ago", "Yesterday" — never raw thousands of minutes */
export function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(timestamp).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

/** One-line calm empty state: a message, never a tall empty box */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-1.5 text-[13px] font-medium text-muted">{children}</p>;
}

/** Panel shell with a consistent header row; height always follows content */
export function Panel({
  title,
  icon,
  action,
  children,
  labelledBy,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section className={cardClass} aria-label={labelledBy ?? title}>
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Today-vs-yesterday delta, using the domain wording so nothing is ever fabricated */
export function Delta({ today, yesterday }: { today: number; yesterday: number }) {
  const d = deltaOf(today, yesterday);
  const label = deltaLabel(d);
  if (d.kind === "up") {
    return (
      <span className="flex items-center gap-1 text-[13px] font-bold text-emerald-700 tabular">
        <TrendingUp className="size-3.5 stroke-[2.5]" aria-hidden="true" />
        <span>{label} vs yesterday</span>
      </span>
    );
  }
  if (d.kind === "down") {
    return (
      <span className="flex items-center gap-1 text-[13px] font-bold text-terracotta tabular">
        <TrendingDown className="size-3.5 stroke-[2.5]" aria-hidden="true" />
        <span>{label} vs yesterday</span>
      </span>
    );
  }
  if (d.kind === "same") {
    return <span className="text-[13px] font-medium text-muted">No change vs yesterday</span>;
  }
  return <span className="text-[13px] font-medium text-muted">{label}</span>;
}
