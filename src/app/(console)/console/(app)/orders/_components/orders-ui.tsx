import { Check, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Shared pieces of the two Orders sections: the queue table on the left, the chosen order on the right.

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";
export const primaryButton = `inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-input bg-forest px-4 text-sm font-semibold text-white transition-colors hover:bg-forest-hover disabled:opacity-50 ${FOCUS}`;
export const secondaryButton = `inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-input border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper disabled:opacity-50 ${FOCUS}`;

/** "12 min" under an hour, then "3h 51m" */
export const waitText = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`);

export type Stat = { icon: LucideIcon; label: string; value: string; note: string; tone?: "forest" | "accent" | "warn" };

export function StatCards({ stats }: { stats: Stat[] }) {
  const iconTone = { forest: "text-forest", accent: "text-terracotta", warn: "text-[var(--state-held-text)]" };
  return (
    <dl className="mt-5 grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      {stats.map(({ icon: Icon, label, value, note, tone = "forest" }) => (
        <div key={label} className={`min-w-0 rounded-2xl border p-3 shadow-[0_1px_2px_rgba(25,37,30,0.035)] sm:p-5 ${tone === "warn" ? "border-[var(--state-held)]/40 bg-[var(--state-held-soft)]" : "border-line bg-surface"}`}>
          <div className="flex items-center justify-between gap-2">
            <dt className={`text-[12px] font-semibold leading-4 sm:text-[13px] ${tone === "warn" ? "text-[var(--state-held-text)]" : "text-muted"}`}>{label}</dt>
            <Icon className={`size-5 shrink-0 ${iconTone[tone]}`} aria-hidden="true" />
          </div>
          <dd className="mt-2 font-display text-[24px] font-bold leading-none tracking-tight text-ink tabular sm:text-[30px]">{value}</dd>
          <dd className={`mt-1.5 truncate text-[11px] font-medium leading-4 ${tone === "warn" ? "text-[var(--state-held-text)]" : "text-muted"}`}>{note}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (key: T) => void; options: { key: T; label: string; count: number }[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-input bg-ink/5 p-1">
      {options.map((option) => (
        <button key={option.key} type="button" aria-pressed={value === option.key} onClick={() => onChange(option.key)} className={`min-h-9 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-semibold transition-colors ${FOCUS} ${value === option.key ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"}`}>
          {option.label} <span className="tabular opacity-70">{option.count}</span>
        </button>
      ))}
    </div>
  );
}

export function QueuePanel({ title, meta, columns, children }: { title: string; meta: string; /** Header row, shown where the table has room for its columns */ columns: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>
        <p className="text-xs font-medium text-muted">{meta}</p>
      </div>
      {columns}
      {children}
    </section>
  );
}

export const columnHead = "hidden items-center gap-3 border-b border-line bg-paper/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted sm:px-5 lg:grid";
export const rowCells = "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-l-2 border-b-line px-4 py-3 last:border-b-0 sm:px-5 lg:gap-y-0";
/** A row's colour: late beats selected beats new; a new order waits with a green edge */
export const rowTone = (selected: boolean, urgent: boolean, fresh = false) => `${urgent ? "bg-[var(--state-seated-soft)]" : selected ? "bg-sage/60" : fresh ? "bg-[var(--state-available-soft)]" : "hover:bg-paper"} ${selected ? "border-l-forest" : urgent ? "border-l-danger" : fresh ? "border-l-[var(--state-available)]" : "border-l-transparent"}`;

/** The whole row chooses the order; the row's own action button sits above this */
export function RowSelect({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={selected} onClick={onSelect} className="block w-full min-w-0 cursor-pointer text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--state-available)]">{children}</button>;
}

export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

export const UrgentTag = () => <span className="whitespace-nowrap rounded bg-[var(--state-seated-soft)] px-1.5 py-0.5 text-[11px] font-bold text-danger">! Urgent</span>;

/** Beside the table on wide screens; a full screen that opens on tap on phones and tablets */
export function DetailSheet({ label, open, sticky = false, children }: { label: string; open: boolean; /** A tall panel stays beside the list and scrolls on its own, with no empty page below the list */ sticky?: boolean; children: ReactNode }) {
  return (
    <aside aria-label={label} className={`no-scrollbar ${open ? "fixed inset-0 z-40 overflow-y-auto bg-surface pb-[calc(env(safe-area-inset-bottom)+5rem)] xl:pb-0" : "hidden"} min-w-0 ${sticky ? "xl:sticky xl:top-22 xl:max-h-[calc(100dvh-6.5rem)] xl:overflow-y-auto" : "xl:static xl:overflow-hidden"} xl:z-auto xl:block xl:rounded-2xl xl:border xl:border-line xl:bg-surface`}>
      {children}
    </aside>
  );
}

export function DetailHead({ title, badge, sub, onClose }: { title: ReactNode; badge: ReactNode; sub: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 bg-sage px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] xl:pt-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 break-words font-display text-lg font-bold leading-6 text-ink">{title}</h2>{badge}</div>
        <p className="mt-1 text-xs font-medium text-muted">{sub}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Close order" className={`grid size-10 shrink-0 cursor-pointer place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink xl:hidden ${FOCUS}`}><X className="size-5" aria-hidden="true" /></button>
    </div>
  );
}

export function DetailSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-b-0">
      {title && <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>}
      {children}
    </section>
  );
}

export function ItemList({ items }: { items: { name: string; qty: number }[] }) {
  if (!items.length) return <p className="text-sm text-muted">No items</p>;
  return (
    <ul className="grid gap-2">
      {items.map((item, i) => <li key={i} className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-ink"><span className="grid h-6 min-w-7 shrink-0 place-items-center rounded-md border border-line px-1 text-xs font-bold tabular">{item.qty}×</span><span className="min-w-0 break-words">{item.name}</span></li>)}
    </ul>
  );
}

export function Stepper({ steps, stage, complete, label }: { steps: readonly string[]; stage: number; complete: boolean; label: string }) {
  return (
    <ol aria-label={label} className="flex items-start border-b border-line px-3 py-4">
      {steps.map((step, i) => {
        const done = i < stage || complete;
        const current = i === stage && !complete;
        return (
          <li key={step} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            {i > 0 && <span aria-hidden="true" className={`absolute right-1/2 top-3 h-px w-full ${i <= stage ? "bg-forest" : "bg-line"}`} />}
            <span className={`relative grid size-6 place-items-center rounded-full text-[11px] font-bold tabular ${done || current ? "bg-forest text-white" : "border border-line bg-surface text-muted"}`}>{done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}</span>
            <span className={`mt-1.5 text-[11px] leading-tight ${current ? "font-bold text-ink" : "font-medium text-muted"}`}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyQueue({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-sage text-forest"><Icon className="size-6" aria-hidden="true" /></span>
      <h3 className="mt-3 font-display text-[15px] font-bold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>
    </div>
  );
}
