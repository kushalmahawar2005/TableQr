"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DashboardData } from "@/server/staff/dashboard";
import { checkInReservationAction } from "../actions";
import { EmptyLine, Panel, timeIn, viewAllClass } from "./dashboard-shared";

/** Next few bookings with the real check-in action (spec §13) */
export function UpcomingReservations({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const reservations = data.operations.upcoming.filter((r) => !doneIds.has(r.id)).slice(0, 3);

  const checkIn = (id: string) => {
    setPendingId(id);
    setFailed(false);
    start(async () => {
      const res = await checkInReservationAction(id).catch(() => null);
      setPendingId(null);
      if (res?.ok) {
        setDoneIds((prev) => new Set(prev).add(id));
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  };

  return (
    <Panel
      title="Upcoming Reservations"
      action={<Link href="/console/reservations" className={viewAllClass}><span>View all</span></Link>}
    >
      {failed && <p className="mb-2 text-xs font-semibold text-rose-700" role="alert">Check-in didn&apos;t go through — try again.</p>}
      {reservations.length === 0 ? (
        <EmptyLine>No reservations due in the next few hours.</EmptyLine>
      ) : (
        <div className="divide-y divide-line">
          {reservations.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{r.name ?? "Guest"}</p>
                <p className="mt-0.5 text-xs font-medium text-muted tabular">
                  {timeIn(r.startAt, data.timezone)} · {r.partySize} {r.partySize === 1 ? "guest" : "guests"}
                  {r.tables.length > 0 ? ` · ${r.tables.map((t) => `Table ${t}`).join(", ")}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => checkIn(r.id)}
                disabled={pendingId === r.id}
                className="inline-flex min-h-10 shrink-0 items-center rounded-input border border-line bg-surface px-3.5 text-sm font-semibold text-forest transition-all hover:border-forest hover:bg-forest hover:text-white cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-forest"
              >
                {pendingId === r.id ? "Working…" : "Check in"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
