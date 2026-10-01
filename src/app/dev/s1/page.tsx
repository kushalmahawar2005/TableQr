import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FloorScreen } from "@/app/(console)/console/(app)/floor/_components/floor-screen";
import FloorLoading from "@/app/(console)/console/(app)/floor/loading";
import { s1Copy } from "@/app/(console)/console/(app)/floor/_copy";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { consoleSections } from "@/lib/console-nav";
import { parseLang } from "@/lib/i18n";
import { canSee, type StaffRole } from "@/lib/staff-permissions";
import { s1Cases } from "./_fixtures";

export const metadata: Metadata = { title: "S1 states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board for S1 Host Floor. One state per page: ?solo=<id> (sheets are
// real dialogs). Pick the viewport in the browser; 1024×768 and 1280×800 are the targets.
export default async function S1Preview(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const cases = s1Cases();
  const solo = cases.find((c) => c.id === q.solo);
  if (!solo) {
    return (
      <main className="p-6">
        <h1 className="font-display text-title font-bold">S1 · Host Floor</h1>
        <p className="text-caption text-muted">Development review board. Sample data. Open a state:</p>
        <ul className="mt-4 grid gap-1 text-body sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <li key={c.id}>
              <a className="text-accent underline" href={`?solo=${c.id}`}>
                {c.label}
              </a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  const lang = solo.lang ?? parseLang(typeof q.lang === "string" ? q.lang : undefined);
  const roles: StaffRole[] = solo.denied ? ["waiter"] : (solo.data.roles as StaffRole[]);
  const sections = consoleSections.filter((s) => canSee(roles, s.slug)).map((s) => ({ slug: s.slug, label: lang === "hi" ? s.hi : s.label }));
  const c = s1Copy[lang];
  return (
    <StaffShell lang={lang} sections={sections} staff={{ name: roles.includes("manager") ? "Meera Joshi" : "Anil Kumar", roles, outlet: "Spice Route", shiftEnds: null }} activeSlug="floor" preview>
      {solo.denied ? (
        <main className="p-8">
          <h1 className="font-display text-title font-bold text-ink">{c.denied}</h1>
          <p className="mt-2 text-body text-muted">{c.deniedBody}</p>
        </main>
      ) : solo.loading ? (
        <FloorLoading />
      ) : (
        <FloorScreen data={solo.data} lang={lang} realtimeUrl={null} preview={solo.preview} />
      )}
    </StaffShell>
  );
}
