import { notFound } from "next/navigation";
import { consoleSections, isConsoleSection } from "@/lib/console-nav";

// Temporary catch for every console section until each gets its own route.
export default async function ConsoleSectionPage(
  props: PageProps<"/console/[section]">,
) {
  const { section } = await props.params;
  if (!isConsoleSection(section)) notFound();

  const label = consoleSections.find((s) => s.slug === section)!.label;

  return (
    <main className="p-6">
      <h1 className="font-display text-title font-medium">{label}</h1>
      <p className="mt-2 text-muted">Placeholder.</p>
    </main>
  );
}
