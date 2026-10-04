import type { CalendarData } from "@/server/staff/reservations";
import { formatTime } from "./calendar-logic";

/** Read-only waitlist and walk-ins for the same period, refreshed with the calendar's data */
export function ReservationCompanion({ data }: { data: Pick<CalendarData, "waitlist" | "walkIns" | "timezone"> }) {
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <section aria-label="Waitlist" className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-section font-bold">Waitlist</h2>
        {data.waitlist.length ? (
          <ul className="mt-3 space-y-2">
            {data.waitlist.map((w) => (
              <li key={w.id} className="rounded-input border border-line p-2 text-caption">
                <strong>{w.name}</strong> · {w.partySize} · {w.status} · #{w.sortOrder}
                <br />~{w.estimateMinutes ?? "—"} min{w.readyDeadline ? ` · ready by ${formatTime(w.readyDeadline, data.timezone)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-caption text-muted">No waitlist guests.</p>
        )}
      </section>
      <section aria-label="Walk-ins" className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-section font-bold">Walk-ins</h2>
        {data.walkIns.length ? (
          <ul className="mt-3 space-y-2">
            {data.walkIns.map((w) => (
              <li key={w.sessionId} className="rounded-input border border-line p-2 text-caption">
                <strong>{w.code}</strong> · {w.partySize ?? "—"} guests · {w.status} · {formatTime(w.openedAt, data.timezone)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-caption text-muted">No walk-ins in this period.</p>
        )}
      </section>
    </div>
  );
}
