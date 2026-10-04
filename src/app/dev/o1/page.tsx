import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { DashboardScreen } from "@/app/(console)/console/(app)/dashboard/_components/dashboard-screen";
import { consoleSections } from "@/lib/console-nav";
import { canSee, type StaffRole } from "@/lib/staff-permissions";
import { dashboardCases } from "./_fixtures";

export const metadata: Metadata = { title: "O1 Dashboard states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board for the O1 Owner Dashboard: the real screen with sample data, one
// state per page (?solo=<id>). Polling and refresh are off in preview.
export default async function DashboardBoard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const cases = dashboardCases();
  const solo = cases.find((c) => c.id === q.solo);
  if (!solo) {
    return (
      <main className="p-6">
        <h1 className="font-display text-title font-bold">O1 Owner Dashboard</h1>
        <p className="text-caption text-muted">Development review board. Sample data. Open a state:</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {cases.map((c) => (
            <li key={c.id}>
              <Link className="inline-flex min-h-11 items-center underline" href={`?solo=${c.id}`}>
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  const roles = (solo.staff?.roles ?? ["owner"]) as StaffRole[];
  const sections = consoleSections.filter((s) => canSee(roles, s.slug)).map((s) => ({ slug: s.slug, label: s.label }));
  const screen = (
    <StaffShell lang="en" sections={sections} staff={{ name: solo.staff?.name ?? "Owner", roles, outlet: solo.data.outletName, shiftEnds: null }} activeSlug="dashboard" preview>
      <DashboardScreen key={solo.id} initial={solo.data} initialTrend={solo.trend} preview={solo.preview ?? {}} />
    </StaffShell>
  );
  return (
    <>
      <p className="px-5 pt-3 text-caption">
        <Link href="/dev/o1" className="underline">
          ← All states
        </Link>{" "}
        · {solo.label}
      </p>
      {screen}
    </>
  );
}
