import { ArrowLeft01Icon, UserAdd01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import type { Lang } from "@/lib/i18n";
import type { TableLanding } from "@/server/guest/table";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { g2Copy } from "../_copy";
import { VerifyForm, type FormSnapshot } from "./verify-form";
import { WhyAsk, WhySheetPanel } from "./why-sheet";

export type VerifyScreenData = {
  outlet: Pick<TableLanding["outlet"], "code" | "name" | "logoUrl" | "accentColor">;
  tableCode: string;
  /** First guest starts the table; later guests join the people already there */
  context: { kind: "start" } | { kind: "join"; count: number };
};

/** G2 Verify number: compact restaurant and table, heading, why, then the form */
export function VerifyScreen({
  data,
  shortCode,
  lang,
  preview,
  sheetOpen,
}: {
  data: VerifyScreenData;
  shortCode: string;
  lang: Lang;
  /** Dev review board only */
  preview?: FormSnapshot;
  sheetOpen?: boolean;
}) {
  const c = g2Copy[lang];
  const { outlet } = data;
  const tablePath = `/r/${encodeURIComponent(outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const style = brandStyle(deriveBrandTokens(outlet.accentColor)) as CSSProperties;
  const isPreview = !!preview;

  return (
    <div lang={lang} style={style} className={`relative flex flex-1 flex-col ${isPreview ? "min-h-full" : "min-h-dvh"}`}>
      <header className="flex items-center gap-2.5 pt-3 pb-1">
        <BackLink href={tablePath} label={c.back} preview={isPreview} />
        <OutletLogo name={outlet.name} logoUrl={outlet.logoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-section font-bold break-words text-ink">{outlet.name}</p>
          <p className="text-caption text-muted">{c.table(data.tableCode)}</p>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={isPreview} />
      </header>

      <main className="flex flex-1 flex-col pt-7">
        <h1 className="font-display text-title font-bold text-ink">{c.heading}</h1>
        <p className="mt-2.5 flex items-center gap-1.5 text-body font-medium text-ink">
          <HugeiconsIcon
            icon={data.context.kind === "join" ? UserGroupIcon : UserAdd01Icon}
            size={18}
            className="shrink-0 text-muted"
            aria-hidden
          />
          {data.context.kind === "join" ? c.joining(data.context.count) : c.starting}
        </p>
        <p className="mt-1.5 text-body text-muted">{c.trust}</p>
        <div className="mt-2.5">
          <WhyAsk lang={lang} preview={isPreview} />
        </div>

        <div className="mt-6 flex flex-1 flex-col border-t border-line/70 pt-6">
          <VerifyForm outletCode={outlet.code} shortCode={shortCode} outletName={outlet.name} lang={lang} preview={preview} />
        </div>
      </main>

      {sheetOpen && (
        <Scrim>
          <WhySheetPanel lang={lang} />
        </Scrim>
      )}
    </div>
  );
}

function BackLink({ href, label, preview }: { href: string; label: string; preview: boolean }) {
  const icon = <HugeiconsIcon icon={ArrowLeft01Icon} size={22} aria-hidden />;
  const cls =
    "-ml-2.5 grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand";
  return preview ? (
    <span className={cls}>{icon}</span>
  ) : (
    <Link href={href} aria-label={label} className={cls}>
      {icon}
    </Link>
  );
}

/** Dev board: the sheet drawn open over the screen */
function Scrim({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 -mx-5 flex flex-col justify-end bg-ink/40">
      {children}
    </div>
  );
}
