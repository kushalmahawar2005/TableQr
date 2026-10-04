import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReservationCalendar } from "@/app/(console)/console/(app)/reservations/_components/reservation-calendar";
import { calendarCases } from "./_fixtures";

export const metadata: Metadata = { title: "Reservation Calendar states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board for the Reservation Calendar: the real screen with sample data,
// one state per page (?solo=<id>). Actions and live sync are off in preview.
export default async function ReservationCalendarBoard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const cases = calendarCases();
  const solo = cases.find((c) => c.id === q.solo);
  if (!solo) {
    return (
      <main className="p-6">
        <h1 className="font-display text-title font-bold">Reservation Calendar</h1>
        <p className="text-caption text-muted">Development review board. Sample data. Open a state:</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {cases.map((c) => (
            <li key={c.id}>
              <Link className="underline" href={`?solo=${c.id}`}>
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  return (
    <>
      <p className="px-5 pt-3 text-caption">
        <Link href="/dev/reservation-calendar" className="underline">
          ← All states
        </Link>{" "}
        · {solo.label}
      </p>
      <ReservationCalendar initial={solo.data} realtimeUrl={null} preview initialSelectedId={solo.selectedId ?? null} />
    </>
  );
}
