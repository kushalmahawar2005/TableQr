"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useKdsActions } from "./kds-actions";
import { liveCard, type KdsCard } from "./kds-logic";
import type { kdsCopy } from "../_copy";

type Copy = (typeof kdsCopy)["en"];

const PAGE = 12;

type State = { open: boolean; cards: KdsCard[]; hasMore: boolean; next: number; loading: boolean; failed: boolean };

/**
 * Open tickets from before the board's 24-hour window. Nothing is fetched until the section is
 * opened, then one page at a time; a ticket's age never completes or removes it.
 */
export function useOlderTickets(station: string | null, staleOpen: number, preview: boolean) {
  const actions = useKdsActions();
  const [state, setState] = useState<State>({ open: false, cards: [], hasMore: false, next: 0, loading: false, failed: false });
  const latest = useRef(state);
  // Kept up to date after each render, so a load started from an event always sees the pages already open
  useEffect(() => { latest.current = state; }, [state]);

  const load = useCallback(async (reset: boolean) => {
    const before = latest.current;
    // Reloading keeps every page already open, so an action does not scroll the list back to the top
    const offset = reset ? 0 : before.next;
    const limit = reset ? Math.min(60, Math.max(PAGE, before.cards.length)) : PAGE;
    setState((s) => ({ ...s, loading: true, failed: false }));
    const res = await actions.older(station, offset, limit).catch(() => null);
    if (!res || !res.ok) {
      setState((s) => ({ ...s, loading: false, failed: true }));
      return;
    }
    setState((s) => ({ ...s, loading: false, cards: reset ? res.data.cards : [...s.cards, ...res.data.cards], hasMore: res.data.hasMore, next: res.data.nextOffset }));
  }, [actions, station]);

  // Opening, or the count / station changing while open, loads the first page (after the render, off the effect's own tick)
  useEffect(() => {
    if (preview || !state.open) return;
    const timer = setTimeout(() => void load(true), 0);
    return () => clearTimeout(timer);
  }, [preview, state.open, staleOpen, station, load]);

  return {
    ...state,
    setOpen: (open: boolean) => setState((s) => ({ ...s, open })),
    more: () => load(false),
    reload: () => (latest.current.open ? load(true) : Promise.resolve()),
  };
}

export type OlderTickets = ReturnType<typeof useOlderTickets>;

/** The collapsible "Older pending tickets" bar and its list, drawn with the board's own cards */
export function OlderPendingTickets(props: { c: Copy; older: OlderTickets; staleOpen: number; now: number; renderCards: (cards: KdsCard[]) => ReactNode }) {
  const { c, older, staleOpen, now } = props;
  if (staleOpen <= 0 && !older.open) return null;
  const shown = older.cards.map((card) => liveCard(card, now));
  return (
    <section aria-label={c.olderTitle(staleOpen)} className="shrink-0 border-b border-kds-line bg-kds-card">
      <button
        type="button"
        aria-expanded={older.open}
        onClick={() => older.setOpen(!older.open)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-[18px] font-semibold"
      >
        <span>{c.olderTitle(staleOpen)}</span>
        <span className="text-kds-muted">{older.open ? c.olderHide : c.olderShow}</span>
      </button>
      {older.open && (
        <div className="max-h-[55vh] overflow-y-auto border-t border-kds-line p-4">
          <p className="mb-3 text-[17px] text-kds-muted">{c.olderHint}</p>
          {older.failed && <p role="alert" className="mb-3 text-[18px] font-semibold">{c.olderFailed}</p>}
          {shown.length === 0 && !older.loading && !older.failed && <p className="text-[18px]">{c.olderEmpty}</p>}
          {shown.length > 0 && <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] items-start gap-4">{props.renderCards(shown)}</div>}
          {older.loading && <p className="mt-3 text-[18px] text-kds-muted">{c.olderLoading}</p>}
          {older.hasMore && !older.loading && (
            <button type="button" onClick={() => void older.more()} className="mt-4 min-h-12 rounded-lg bg-kds-bg px-5 text-[18px] font-semibold">
              {c.olderMore}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
