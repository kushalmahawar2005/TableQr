import { connectRealtime } from "@/lib/realtime-client";
import type { CalendarData, CalendarInput } from "@/server/staff/reservations";
import { toInput, type CalendarQuery } from "./calendar-logic";

// Live data for the Reservation Calendar. The controller owns the current query, so a reload from
// the user, the 20-second poll or a realtime hint always asks for the same date, view, search and
// filters. Only the newest answer is applied.

type Result = { ok: true; data: CalendarData } | { ok: false; code: string; message: string };

export function createCalendarSync(opts: { query: CalendarQuery; load: (input: CalendarInput) => Promise<Result>; onData: (data: CalendarData, query: CalendarQuery) => void; onError: (code: string, message: string) => void }) {
  let query = opts.query;
  let seq = 0;
  async function refresh(change?: Partial<CalendarQuery>) {
    if (change) query = { ...query, ...change };
    const mine = ++seq;
    let res: Result;
    try {
      res = await opts.load(toInput(query));
    } catch {
      res = { ok: false, code: "failed", message: "Could not load reservations. Retrying." };
    }
    if (mine !== seq) return;
    if (!res.ok) return opts.onError(res.code, res.message);
    // "Today" asks without a date; the server answers with the outlet's own today
    query = { ...query, date: res.data.date, view: res.data.view };
    opts.onData(res.data, query);
  }
  return {
    refresh,
    /** Jump to today in the outlet's time zone, keeping view, search and filters */
    today: () => refresh({ date: "" }),
    get query() {
      return query;
    },
  };
}

export type CalendarSync = ReturnType<typeof createCalendarSync>;

/** Poll every 20 seconds and reload on every realtime hint or reconnect; returns a stop function */
export function startCalendarSync(
  sync: Pick<CalendarSync, "refresh">,
  opts: { realtimeUrl: string | null; getToken: () => Promise<string | null>; pollMs?: number; connect?: typeof connectRealtime; every?: (fn: () => void, ms: number) => () => void; visible?: () => boolean },
) {
  const visible = opts.visible ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  const every =
    opts.every ??
    ((fn, ms) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    });
  const stopPoll = every(() => {
    if (visible()) void sync.refresh();
  }, opts.pollMs ?? 20_000);
  const stopRealtime = (opts.connect ?? connectRealtime)({ url: opts.realtimeUrl, getToken: opts.getToken, onEvents: () => void sync.refresh(), onResync: () => void sync.refresh() });
  return () => {
    stopPoll();
    stopRealtime();
  };
}
