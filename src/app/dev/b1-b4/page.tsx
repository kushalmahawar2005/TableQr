import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "B1–B4 booking states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const cases = [
  ["b1-normal", "B1 · Normal slots"], ["b1-full", "B1 · Full slot"], ["b1-alternatives", "B1 · Alternatives"], ["b1-credit", "B1 · Credit selected"], ["b1-group", "B1 · Group request"], ["b1-closed", "B1 · Closed day"], ["b1-blackout", "B1 · Blackout"], ["b1-paused", "B1 · Booking paused"], ["b1-hold", "B1 · Hold active"], ["b1-expiring", "B1 · Hold expiring"],
  ["b2-otp", "B2 · OTP"], ["b2-wrong", "B2 · Wrong OTP"], ["b2-rate", "B2 · Rate limited"], ["b2-returning", "B2 · Returning guest"], ["b2-credit", "B2 · Credit"], ["b2-expired", "B2 · Hold expired"],
  ["b3-confirmed", "B3 · Confirmed"], ["b3-credit", "B3 · Credit paid"], ["b3-late", "B3 · Late extension"], ["b3-cancelled", "B3 · Guest cancelled"], ["b3-restaurant", "B3 · Restaurant cancelled"], ["b3-refund", "B3 · Refund pending"], ["b3-no-show", "B3 · No-show"],
  ["b4-joined", "B4 · Joined"], ["b4-position", "B4 · Position update"], ["b4-two-ahead", "B4 · Two parties ahead"], ["b4-ready", "B4 · Table ready"], ["b4-skipped", "B4 · Skipped"], ["b4-restored", "B4 · Restored"], ["b4-leave", "B4 · Leave confirmation"], ["b4-fallback", "B4 · Estimate fallback"],
] as const;

export default async function B1B4Preview(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams; const solo = typeof q.solo === "string" ? q.solo : null; const current = cases.find(([id]) => id === solo);
  if (current) return <main className="mx-auto min-h-dvh max-w-[520px] px-5 py-8 text-ink"><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted">Development review board</p><h1 className="mt-2 font-display text-3xl font-bold">{current[1]}</h1><div className="mt-6 rounded-2xl border border-line bg-surface p-5"><p className="text-body">Deterministic B1–B4 state: {current[0]}</p><p className="mt-3 text-sm text-muted">Production data and server actions are used by the real routes. This board is presentation-only and never authorizes a booking mutation.</p></div><a className="mt-5 inline-block underline" href="/dev/b1-b4">Back to all states</a></main>;
  return <main className="min-h-dvh bg-paper p-6 text-ink"><h1 className="font-display text-3xl font-bold">B1–B4 combined booking</h1><p className="mt-2 text-muted">Development-only state board. Open one state with <code>?solo=state</code>.</p><ul className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{cases.map(([id, label]) => <li key={id}><a className="block rounded-xl border border-line bg-surface p-3 underline" href={`?solo=${id}`}>{label}</a></li>)}</ul></main>;
}
