import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaidScreen } from "@/app/(guest)/r/[outlet]/t/[table]/paid/_components/paid-screen";
import PaidLoading from "@/app/(guest)/r/[outlet]/t/[table]/paid/loading";
import { parseLang } from "@/lib/i18n";
import { g9Cases, type G9Case } from "./_fixtures";

export const metadata: Metadata = { title: "G9 states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board for G9 Paid, receipt and next visit.
// Open a state alone with ?solo=<id>; add &text=2 for 200% text.
export default async function G9Preview(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const lang = parseLang(typeof q.lang === "string" ? q.lang : undefined);
  const cases = g9Cases();
  const render = (c: G9Case) => (c.loading ? <PaidLoading /> : <PaidScreen data={c.data} lang={c.lang ?? lang} shortCode="k7Qm" realtimeUrl={null} preview={c.preview} />);
  const solo = cases.find((c) => c.id === q.solo);
  if (solo) {
    return (
      <div data-big={q.text === "2" || undefined} className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 min-[360px]:px-5">
        {q.text === "2" && <style>{BIG_TEXT}</style>}
        {render(solo)}
      </div>
    );
  }
  return (
    <div className="min-h-dvh bg-[#ECE7DF] p-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-title font-bold">G9 · Paid, receipt and next visit</h1>
        <a href="?lang=en" className="text-accent underline">English</a>
        <a href="?lang=hi" className="text-accent underline">Hindi</a>
        <p className="text-caption text-muted">Development review board. Sample visits. Add &amp;text=2 to a solo state for 200% text.</p>
      </header>
      <ul className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-caption">
        {cases.filter((c) => c.solo).map((c) => (
          <li key={c.id}><a className="text-accent underline" href={`?solo=${c.id}&lang=${lang}`}>{c.label}</a></li>
        ))}
      </ul>
      <div className="flex flex-wrap items-start gap-6">
        {cases.filter((c) => !c.solo).map((c) => (
          <figure key={c.id} style={{ width: c.width ?? 360 }}>
            <figcaption className="mb-2 text-caption font-semibold text-muted"><a href={`?solo=${c.id}&lang=${c.lang ?? lang}`}>{c.label}</a></figcaption>
            <div style={{ height: c.height ?? 820 }} className="relative overflow-auto rounded-[28px] border border-line bg-paper px-4 [transform:translateZ(0)] min-[360px]:px-5">{render(c)}</div>
          </figure>
        ))}
      </div>
    </div>
  );
}

const TYPE = { display: [32, 38], title: [22, 28], section: [16, 22], body: [14, 20], caption: [12, 16], label: [11, 14], button: [14, 20] };
const BIG_TEXT = Object.entries(TYPE).map(([k, [size, lh]]) => `[data-big] .text-${k}{font-size:${size * 2}px;line-height:calc(${lh * 2}px * var(--lh))}`).join("\n");
