import Link from "next/link";
import type { CSSProperties } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import type { Lang } from "@/lib/i18n";
import type { MenuScreenData } from "@/server/guest/menu-screen";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { g3Copy } from "../_copy";
import { MenuClient, type MenuPreview } from "./menu-client";

/**
 * G3 Menu. The header is compact and has no back arrow: this is the guest's home at the table,
 * and G1 would only send them straight back here.
 */
export function MenuScreen({
  data,
  lang,
  shortCode,
  realtimeUrl,
  preview,
}: {
  data: MenuScreenData;
  lang: Lang;
  shortCode: string;
  realtimeUrl: string | null;
  preview?: MenuPreview;
}) {
  const c = g3Copy[lang];
  const style = brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties;
  return (
    <div lang={lang} style={style} className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      <header className="flex items-center gap-3 pt-4">
        <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-section font-bold break-words text-ink">{data.outlet.name}</p>
          {/* The table badge opens G7 Table & People: a plain link, no G7 code in this bundle */}
          <Link
            href={preview ? "#" : `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}/table`}
            prefetch={false}
            className="relative text-caption text-muted underline-offset-2 before:absolute before:-inset-y-3.5 before:inset-x-0 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {c.tableLine(data.table.code, data.session.people)} <span aria-hidden>›</span>
          </Link>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
      </header>
      <main className="flex flex-1 flex-col">
        <MenuClient
          data={data}
          lang={lang}
          shortCode={shortCode}
          renderedAt={data.renderedAt}
          realtimeUrl={realtimeUrl}
          sessionKey={data.session.key}
          preview={preview}
        />
      </main>
    </div>
  );
}
