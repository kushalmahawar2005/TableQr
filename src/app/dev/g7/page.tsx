import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LandingView } from "@/app/(guest)/r/[outlet]/t/[table]/_components/landing-view";
import { TableScreen } from "@/app/(guest)/r/[outlet]/t/[table]/table/_components/table-screen";
import TableLoading from "@/app/(guest)/r/[outlet]/t/[table]/table/loading";
import { parseLang, type Lang } from "@/lib/i18n";
import { publicOrigin, tableInvite } from "@/server/guest/invite";
import { g7Cases, type G7Case } from "./_fixtures";

export const metadata: Metadata = { title: "G7 states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board for G7 Table & People. Sheets and confirmations open as real
// dialogs, so they are shown one at a time (?solo=<id>). Add &text=2 for 200% text.

export default async function G7Preview(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const lang = parseLang(typeof q.lang === "string" ? q.lang : undefined);
  const { qrPath, qrBox } = tableInvite(publicOrigin(await headers()), "SRJ01", "k7Qm");
  const invite = { qrPath, qrBox };
  const cases = g7Cases();

  const render = (c: G7Case, l: Lang) =>
    c.loading ? (
      <TableLoading />
    ) : c.removedLanding ? (
      <LandingView
        preview
        lang={l}
        shortCode="k7Qm"
        data={{
          outlet: { code: "SRJ01", name: "Spice Route", city: "Jaipur", logoUrl: null, accentColor: "#C9482B", sessionMode: "open", isOpen: true, closesAt: "23:30", nextOpen: null, poweredBy: false },
          table: { code: "T12", maxSeats: 4, zone: "Indoor", state: "seated" },
          landing: { kind: "removed" },
        }}
      />
    ) : (
      <TableScreen data={c.data} lang={l} shortCode="k7Qm" realtimeUrl={null} invite={invite} preview={c.preview} />
    );

  const solo = cases.find((c) => c.id === q.solo);
  if (solo) {
    return (
      <div data-big={q.text === "2" || undefined} className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 min-[360px]:px-5">
        {q.text === "2" && <style>{BIG_TEXT}</style>}
        {render(solo, solo.lang ?? lang)}
      </div>
    );
  }
  return (
    <div className="min-h-dvh bg-[#ECE7DF] p-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-title font-bold">G7 · Table &amp; People</h1>
        <a href="?lang=en" className="text-accent underline">English</a>
        <a href="?lang=hi" className="text-accent underline">Hindi</a>
        <p className="text-caption text-muted">Development review board. Sample tables only. Open a state alone with its label; add &amp;text=2 for 200% text.</p>
      </header>
      <ul className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-caption">
        {cases.filter((c) => c.solo).map((c) => (
          <li key={c.id}>
            <a className="text-accent underline" href={`?solo=${c.id}&lang=${lang}`}>{c.label}</a>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-start gap-6">
        {cases.filter((c) => !c.solo).map((c) => (
          <figure key={c.id} style={{ width: c.width ?? 360 }}>
            <figcaption className="mb-2 text-caption font-semibold text-muted">
              <a href={`?solo=${c.id}&lang=${c.lang ?? lang}`}>{c.label}</a>
            </figcaption>
            <div style={{ height: c.height ?? 820 }} className="relative overflow-auto rounded-[28px] border border-line bg-paper px-4 [transform:translateZ(0)] min-[360px]:px-5">
              {render(c, c.lang ?? lang)}
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

const TYPE = { display: [32, 38], title: [22, 28], section: [16, 22], body: [14, 20], caption: [12, 16], label: [11, 14], button: [14, 20] };
const BIG_TEXT = Object.entries(TYPE)
  .map(([k, [size, lh]]) => `[data-big] .text-${k}{font-size:${size * 2}px;line-height:calc(${lh * 2}px * var(--lh))}`)
  .join("\n");
