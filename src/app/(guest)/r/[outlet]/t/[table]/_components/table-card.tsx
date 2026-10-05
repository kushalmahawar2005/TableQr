import type { ReactNode } from "react";

/**
 * The largest thing on G1: which table this phone is at, then its live state and what that
 * means. Without `title` the card carries only the state (revoked or unknown codes).
 */
export function TableCard({
  eyebrow,
  title,
  meta,
  status,
  children,
  summary,
  className = "",
}: {
  eyebrow?: string;
  title?: string;
  meta?: string;
  status: ReactNode;
  children?: ReactNode;
  /** One sentence for screen readers: table, seats, zone and state */
  summary?: string;
  className?: string;
}) {
  return (
    <section aria-label={summary} className={`rounded-guest border border-line bg-surface px-5 py-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ${className}`}>
      {title ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-muted">{eyebrow}</p>
            <h1 className="mt-0.5 font-display text-display font-bold text-ink tabular">{title}</h1>
            {meta && <p className="mt-0.5 text-body text-muted">{meta}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-1">{status}</div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">{status}</div>
      )}
      {children && <div className={title ? "mt-4 border-t border-line/70 pt-4" : "mt-4"}>{children}</div>}
    </section>
  );
}

/** What the state means for this guest: a strong line, then a smaller one */
export function CardMessage({ title, body, large }: { title: string; body?: string; large?: boolean }) {
  return (
    <div role="status">
      <h2 className={`font-display font-bold text-ink ${large ? "text-title" : "text-section"}`}>{title}</h2>
      {body && <p className="mt-1 text-body text-muted">{body}</p>}
    </div>
  );
}

/** People already at the table: initials and names only when they are real names */
export function PeopleHere({ names, line, hostLine }: { names: string[] | null; line: string; hostLine?: string }) {
  const shown = names?.slice(0, 3) ?? [];
  const extra = (names?.length ?? 0) - shown.length;
  return (
    <div className="flex items-center gap-3">
      {shown.length > 0 && (
        <div aria-hidden className="flex shrink-0">
          {shown.map((n, i) => (
            <span
              key={i}
              className="-ml-2 grid size-8 place-items-center rounded-full border-2 border-surface bg-brand-soft text-caption font-bold text-brand-strong first:ml-0"
            >
              {Array.from(n.trim())[0]?.toUpperCase()}
            </span>
          ))}
          {extra > 0 && (
            <span className="-ml-2 grid size-8 place-items-center rounded-full border-2 border-surface bg-ink text-caption font-bold text-white tabular">
              +{extra}
            </span>
          )}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-body font-semibold text-ink">{line}</p>
        {hostLine && <p className="text-caption text-muted">{hostLine}</p>}
      </div>
    </div>
  );
}
