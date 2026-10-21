import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Guide } from "@/app/(console)/console/(app)/_components/guide/guide";
import { SetupChecklist } from "@/app/(console)/console/(app)/_components/guide/setup-checklist";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { consoleSections } from "@/lib/console-nav";
import { parseLang } from "@/lib/i18n";
import { canSee, type StaffRole } from "@/lib/staff-permissions";

export const metadata: Metadata = { title: "First-run guide (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board for the first-run guide: the welcome opens on load, the setup
// list sits on the page and its "Take the tour" button runs the spotlight tour. ?lang=hi, ?done=all
export default async function GuideBoard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const lang = parseLang(typeof q.lang === "string" ? q.lang : undefined);
  const roles: StaffRole[] = ["owner"];
  const sections = consoleSections.filter((s) => canSee(roles, s.slug)).map((s) => ({ slug: s.slug, label: lang === "hi" ? s.hi : s.label }));
  const all = q.done === "all";
  const steps = (["details", "menu", "tables", "qr", "team", "order"] as const).map((key, i) => ({ key, done: all || i === 2, href: "#" }));
  return (
    <StaffShell lang={lang} sections={sections} staff={{ name: "Kushal Mahawar", roles, outlet: "Sharma Dhaba", shiftEnds: null }} activeSlug="dashboard" kitchen preview>
      <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <h1 className="font-display text-title font-bold text-ink">Good afternoon, Kushal</h1>
        <SetupChecklist lang={lang} steps={steps} />
      </main>
      <Guide lang={lang} name="Kushal Mahawar" sections={sections} kitchen welcomeSeen={false} />
    </StaffShell>
  );
}
