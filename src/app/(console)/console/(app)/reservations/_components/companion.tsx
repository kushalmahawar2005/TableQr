import Link from "next/link";
import type { CalendarData } from "@/server/staff/reservations";
import { formatTime } from "./calendar-logic";
import { VisitRecord } from "./visit-record";

/** Read-only waitlist and walk-ins for the same period, refreshed with the calendar's data */
export function ReservationCompanion({ data }: { data: Pick<CalendarData, "waitlist" | "walkIns" | "timezone"> }) {
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <section aria-label="Waitlist" className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-2"><h2 className="font-display text-section font-bold">Waiting for a table</h2><Link href="/console/waitlist" className="text-body font-semibold underline underline-offset-4">Open waitlist</Link></div>
        {data.waitlist.length ? (
          <ul className="mt-3 space-y-2">
            {data.waitlist.map((w) => (
              <li key={w.id} className="rounded-input border border-line p-2 text-caption">
                <strong>{w.name}</strong> · {w.partySize} {w.partySize === 1 ? "guest" : "guests"} · <span className="capitalize">{w.status === "notified" ? "called" : w.status}</span>
                <br />About {w.estimateMinutes ?? "—"} min to go{w.readyDeadline ? ` · table ready by ${formatTime(w.readyDeadline, data.timezone)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-muted">Nobody is waiting right now.</p>
        )}
      </section>
      <section aria-label="Walk-ins" className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-section font-bold">Walk-ins <span className="text-body font-normal text-muted">(came without a booking)</span></h2>
        {data.walkIns.length ? (
          <ul className="mt-3 space-y-2">
            {data.walkIns.map((w) => (
              <li key={w.sessionId}>
                <VisitRecord sessionId={w.sessionId} className="block w-full rounded-input border border-line p-2.5 text-left text-body hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-brand">
                  <strong>Table {w.code}</strong> · {w.partySize ?? "—"} guests · <span>{w.status === "closed" ? "Finished" : w.status === "bill_requested" ? "Bill asked" : "Eating now"}</span> · came at {formatTime(w.openedAt, data.timezone)}
                  <span className="mt-0.5 block text-caption font-semibold text-muted underline underline-offset-4">View what they ordered and paid</span>
                </VisitRecord>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-muted">No walk-ins in this period.</p>
        )}
      </section>
    </div>
  );
}
