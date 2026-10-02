import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { KdsScreen } from "@/app/(staff)/kds/_components/kds-screen";
import { KdsSetup } from "@/app/(staff)/kds/_components/kds-setup";
import { s2Cases } from "./_fixtures";

export const metadata: Metadata = { title: "S2 states (dev)", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#141a2b", colorScheme: "dark" };
export const dynamic = "force-dynamic";

// Development-only review board for S2 Kitchen Display. One state per page: ?solo=<id>.
// Targets: 1366×768 and 1920×1080 wall screens. Sample data only.
export default async function S2Preview(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const cases = s2Cases();
  const solo = cases.find((c) => c.id === q.solo);
  if (!solo) {
    return (
      <main className="min-h-dvh bg-kds-bg p-6 text-kds-text">
        <h1 className="font-display text-[28px] font-bold">S2 · Kitchen Display</h1>
        <p className="text-[18px] text-kds-muted">Development review board. Sample data. Open a state:</p>
        <ul className="mt-4 grid gap-1 text-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <li key={c.id}>
              <a className="underline" href={`?solo=${c.id}`}>
                {c.label}
              </a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  if (solo.setup) return <KdsSetup initialLang={solo.setup.lang ?? "en"} preview={solo.setup} />;
  return <KdsScreen key={solo.id} initial={solo.board!} device={solo.device!} realtimeUrl={null} preview={solo.preview ?? {}} />;
}
