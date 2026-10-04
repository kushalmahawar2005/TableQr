import { notFound } from "next/navigation";
import { consoleSections, isConsoleSection, isLiveSection } from "@/lib/console-nav";
import { canSee } from "@/lib/staff-permissions";
import { currentStaff } from "@/server/staff/request";

// Temporary catch for console sections that do not have their own screen yet.
export default async function ConsoleSectionPage(props: PageProps<"/console/[section]">) {
  const { section } = await props.params;
  if (!isConsoleSection(section) || !isLiveSection(section)) notFound();
  const staff = await currentStaff();
  if (!staff || !canSee(staff.roles, section)) notFound();
  const label = consoleSections.find((s) => s.slug === section)!.label;
  return (
    <main className="p-6">
      <h1 className="font-display text-title font-bold text-ink">{label}</h1>
      <p className="mt-2 text-body text-muted">This screen is not built yet.</p>
    </main>
  );
}
