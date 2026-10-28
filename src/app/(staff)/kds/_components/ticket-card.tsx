"use client";
import { isDeliveryTable } from "@/domain/delivery";
import {
  Cancel01Icon,
  Alert02Icon,
  AlertDiamondIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  Fire03Icon,
  PauseCircleIcon,
  Tick02Icon,
  Loading03Icon,
  Note01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Lang } from "@/lib/i18n";
import type { KdsCopy } from "../_copy";
import { formatElapsed, isFresh, type KdsCard, type Urgency } from "./kds-logic";

const HEAD: Record<Urgency, string> = {
  new: "bg-kds-new text-kds-text",
  on_time: "bg-kds-ok text-kds-text",
  getting_late: "bg-kds-amber text-kds-bg",
  late: "bg-kds-late text-kds-text",
};
const EDGE: Record<Urgency, string> = {
  new: "border-kds-new",
  on_time: "border-kds-ok",
  getting_late: "border-kds-amber",
  late: "border-kds-late",
};
const ICON = { new: Clock01Icon, on_time: Clock01Icon, getting_late: Alert02Icon, late: AlertDiamondIcon };

export type CardAction = "accept" | "start" | "bump";

// Three different colours, icons and words, so the next step reads from across the kitchen
const ACTION_STYLE: Record<CardAction, string> = {
  accept: "bg-kds-new text-kds-text",
  start: "bg-kds-text text-kds-bg",
  bump: "bg-kds-ok text-kds-text",
};
const ACTION_ICON = { accept: Tick02Icon, start: Fire03Icon, bump: CheckmarkCircle02Icon };

type Props = {
  card: KdsCard;
  lang: Lang;
  c: KdsCopy;
  /** Expeditor screens tag each ticket with its station */
  showStation: boolean;
  /** False offline, or when this screen may not change this ticket */
  canAct: boolean;
  busy: CardAction | null;
  busyLines: ReadonlySet<string>;
  leaving: boolean;
  onAction: (card: KdsCard, action: CardAction) => void;
  onBumpLine: (card: KdsCard, lineId: string) => void;
  /** Prints this ticket's kitchen slip (KOT) */
  onPrint?: () => void;
  /** Cancel one item, even after accept (asks for a reason and a manager) */
  onCancelLine?: (card: KdsCard, line: KdsCard["lines"][number]) => void;
};

export function TicketCard({ card, lang, c, showStation, canAct, busy, busyLines, leaving, onAction, onBumpLine, onPrint, onCancelLine }: Props) {
  const name = (en: string, hi: string | null) => (lang === "hi" && hi ? hi : en);
  const fresh = isFresh(card);
  const waiting = !!card.awaitingStaff;
  const sourceLabel = card.source === "walk_in" ? c.walkIn : card.source === "reservation" ? c.reservation : card.source === "waitlist" ? c.waitlist : null;
  const linesActive = canAct && !card.awaitingStaff && card.stage === "preparing";
  const action: CardAction | null = card.awaitingStaff ? null : card.stage === "placed" ? "accept" : card.stage === "accepted" ? "start" : "bump";

  return (
    <article
      aria-label={`${card.tableCodes.join(" + ")} · ${c.round(card.roundNo)} · ${waiting ? c.awaiting : c.urgency[card.urgency]}`}
      className={`kds-ticket-card flex min-w-0 flex-col overflow-hidden rounded-xl border-[3px] bg-kds-card transition-opacity duration-500 ${waiting ? "border-dashed border-kds-muted" : EDGE[card.urgency]} ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <header className={`kds-ticket-header px-4 py-3 ${waiting ? "bg-kds-line text-kds-text" : HEAD[card.urgency]}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="kds-ticket-title flex items-center gap-2 font-display text-[34px] font-bold leading-[38px] tracking-tight">
              {card.tableCodes.some(isDeliveryTable) ? <span className="flex items-center gap-2"><span className="rounded-md bg-kds-text px-2 py-0.5 font-sans text-[18px] font-bold leading-6 tracking-wide text-kds-bg">DELIVERY</span>{card.placedBy?.name ?? ""}</span> : card.tableCodes.join(" + ")}
              {fresh && <span className="rounded-md bg-kds-text px-2 py-0.5 font-sans text-[16px] font-bold leading-5 tracking-wide text-kds-bg">{c.newTag}</span>}
            </h2>
            <p className="kds-ticket-subtitle text-[20px] font-semibold leading-7">
              {c.round(card.roundNo)}
              {showStation && <span> · {card.station}</span>}
            </p>
          </div>
          {waiting ? (
            <p className="flex shrink-0 items-center gap-2 pt-1 text-[20px] font-bold leading-7">
              <HugeiconsIcon icon={PauseCircleIcon} size={26} strokeWidth={2.2} aria-hidden />
              {c.awaiting}
            </p>
          ) : (
          <div className="shrink-0 text-right">
            <p className="kds-ticket-timer tabular font-display text-[34px] font-bold leading-[38px]" aria-label="elapsed">
              {formatElapsed(card.elapsedMs)}
            </p>
            <p className="kds-ticket-status flex items-center justify-end gap-1.5 text-[18px] font-semibold leading-6">
              <HugeiconsIcon icon={ICON[card.urgency]} size={20} strokeWidth={2.2} aria-hidden />
              {c.urgency[card.urgency]}
            </p>
          </div>
          )}
        </div>
        {onPrint && (
          <button type="button" onClick={onPrint} className="mt-2 rounded-md bg-black/15 px-2.5 py-1 text-[16px] font-semibold">
            {c.printKot}
          </button>
        )}
      </header>

      <div className="kds-ticket-meta flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-kds-line px-4 py-2 text-[18px] leading-7 text-kds-muted">
        {!waiting && <span className="tabular">{c.target(card.targetMinutes)}</span>}
        {card.guests ? (
          <span className="flex items-center gap-1.5">
            <HugeiconsIcon icon={UserGroupIcon} size={20} aria-hidden />
            {c.guests(card.guests)}
          </span>
        ) : null}
        {sourceLabel && <span>{sourceLabel}</span>}
        {card.placedBy && <span className="truncate">{card.placedBy.kind === "staff" ? c.byStaff(card.placedBy.name) : c.byGuest(card.placedBy.name)}</span>}
      </div>

      {card.orderNote && (
        <div className="kds-ticket-note mx-4 mt-3 flex gap-2 rounded-lg border-2 border-kds-amber px-3 py-2 text-[20px] font-semibold leading-7 text-kds-text">
          <HugeiconsIcon icon={Note01Icon} size={22} className="mt-0.5 shrink-0 text-kds-amber" aria-hidden />
          <span>
            <span className="sr-only">{c.orderNote}: </span>
            {card.orderNote}
          </span>
        </div>
      )}

      <ul className="kds-ticket-lines flex flex-1 flex-col py-1">
        {card.lines.map((line) => {
          const mine = !line.otherStation;
          const actionable = mine && linesActive && !line.done;
          const working = busyLines.has(line.id);
          return (
            <li key={line.id} className={`flex items-stretch ${line.otherStation ? "opacity-45" : ""}`}>
              <button
                type="button"
                disabled={!actionable || working}
                onClick={() => onBumpLine(card, line.id)}
                aria-label={actionable ? `${name(line.nameEn, line.nameHi)} — ${c.tapReady}` : undefined}
                className={`grid min-h-[60px] min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-start gap-3 py-2.5 pl-4 text-left ${onCancelLine ? "pr-1" : "pr-4"} ${actionable ? "cursor-pointer active:bg-kds-line" : "cursor-default"}`}
              >
                <span className={`tabular w-10 text-[24px] font-bold leading-8 ${line.done ? "text-kds-muted" : "text-kds-text"}`}>{line.qty}×</span>
                <span className="min-w-0">
                  <span className={`kds-ticket-item-name block text-kds font-semibold ${line.done ? "text-kds-muted line-through decoration-2" : "text-kds-text"}`}>{name(line.nameEn, line.nameHi)}</span>
                  {line.modifiers.length > 0 && (
                    <span className="block text-[19px] leading-7 text-kds-text/90">{line.modifiers.map((m) => `+ ${name(m.en, m.hi)}`).join("  ")}</span>
                  )}
                  {line.note && <span className="mt-1 block rounded-md bg-kds-amber/20 px-2 py-0.5 text-[19px] font-semibold italic leading-7 text-kds-text">“{line.note}”</span>}
                  <Warnings line={line} c={c} />
                  {line.otherStation && <span className="mt-1 inline-block rounded-md border border-kds-muted px-2 text-[16px] font-semibold leading-6 text-kds-muted">{c.otherStation(line.station)}</span>}
                  {line.personalForPickup && <span className="mt-1 inline-block rounded-md border border-kds-amber px-2 text-[16px] font-semibold leading-6 text-kds-amber">{c.packForPickup}</span>}
                </span>
                <span className="flex min-w-[44px] flex-col items-center pt-0.5">
                  {working ? (
                    <HugeiconsIcon icon={Loading03Icon} size={34} className="animate-spin text-kds-muted" aria-hidden />
                  ) : line.done ? (
                    <>
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={34} className="text-kds-ok" strokeWidth={2.2} aria-hidden />
                      <span className="text-[16px] font-semibold leading-5 text-kds-muted">{line.status === "served" ? c.served : c.ready}</span>
                    </>
                  ) : actionable ? (
                    <HugeiconsIcon icon={CircleIcon} size={34} className="text-kds-text" strokeWidth={2} aria-hidden />
                  ) : null}
                </span>
              </button>
              {onCancelLine && mine && canAct && line.status !== "served" && (
                <button type="button" onClick={() => onCancelLine(card, line)} aria-label={`${c.cancelItem}: ${name(line.nameEn, line.nameHi)}`} title={c.cancelItem} className="mr-2 grid w-11 shrink-0 place-items-center self-start rounded-lg py-3 text-kds-muted hover:bg-kds-line hover:text-kds-late">
                  <HugeiconsIcon icon={Cancel01Icon} size={22} aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="kds-ticket-footer p-3 pt-1">
        {card.awaitingStaff ? (
          <div className="rounded-lg border-2 border-kds-muted px-3 py-3 text-center">
            <p className="text-[22px] font-bold leading-7 text-kds-text">{c.awaiting}</p>
            <p className="text-[18px] leading-6 text-kds-muted">{c.awaitingBody}</p>
          </div>
        ) : (
          <>
            {linesActive && <p className="mb-1.5 text-center text-[16px] leading-6 text-kds-muted">{c.tapReady}</p>}
            <button
              type="button"
              disabled={!canAct || !!busy}
              onClick={() => action && onAction(card, action)}
              className={`kds-ticket-action flex h-16 w-full items-center justify-center gap-3 rounded-lg text-[24px] font-bold disabled:opacity-50 ${ACTION_STYLE[action ?? "bump"]}`}
            >
              {!busy && <HugeiconsIcon icon={ACTION_ICON[action ?? "bump"]} size={28} strokeWidth={2.4} aria-hidden />}
              {busy ? c.working : action === "accept" ? c.accept : action === "start" ? c.start : c.bump}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

function Warnings({ line, c }: { line: KdsCard["lines"][number]; c: KdsCopy }) {
  const known = line.allergens ?? [];
  const pills = [
    ...(line.jain ? [<span key="jain" className="rounded-md bg-kds-text px-2 text-[17px] font-bold leading-7 text-kds-bg">{c.jain}</span>] : []),
    ...known.map((a) => (
      <span key={a} className="rounded-md bg-kds-late px-2 text-[17px] font-bold leading-7 text-kds-text">
        {c.allergen(a)}
      </span>
    )),
    ...(line.spice && line.spice > 0 ? [<span key="spice" className="rounded-md border border-kds-amber px-2 text-[17px] font-semibold leading-7 text-kds-amber">{c.spice(line.spice)}</span>] : []),
  ];
  return (
    <>
      {pills.length > 0 && <span className="mt-1 flex flex-wrap gap-1.5">{pills}</span>}
      {/* Unknown is never shown as "no allergens" */}
      {line.allergens === null && !line.done && <span className="mt-1 block text-[16px] leading-6 text-kds-muted">{c.allergensUnknown}</span>}
    </>
  );
}
