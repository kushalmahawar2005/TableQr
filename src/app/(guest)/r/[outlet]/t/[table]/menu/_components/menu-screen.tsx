import { ShoppingBag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import type { Lang } from "@/lib/i18n";
import type { MenuScreenData } from "@/server/guest/menu-screen";
import { LanguageToggle } from "../../_components/language-toggle";
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
  const roomDashboard = `/r/${encodeURIComponent(data.outlet.code)}/room/${encodeURIComponent(shortCode)}`;
  return (
    <div lang={lang} style={style} className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      {data.table.isRoom && !preview && (
        <Link
          href={roomDashboard}
          prefetch={false}
          className="mt-3 inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-body font-semibold text-brand-strong hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span aria-hidden>←</span>
          {lang === "hi" ? "रूम डैशबोर्ड पर वापस" : "Back to room dashboard"}
        </Link>
      )}
      <header className="flex items-center gap-3 pt-5">
        <div className="min-w-0 flex-1">
          <p className="font-display text-title font-bold break-words text-brand-strong">{data.outlet.name}</p>
          {/* The table badge opens G7 Table & People: a plain link, no G7 code in this bundle */}
          <Link
            href={preview ? "#" : `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}/table`}
            prefetch={false}
            className="relative text-body text-muted underline-offset-2 before:absolute before:-inset-y-3.5 before:inset-x-0 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {c.tableLine(data.table.code, data.session.people)} <span aria-hidden>›</span>
          </Link>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
        <Link
          href={preview ? "#" : `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}/cart?from=menu`}
          prefetch={false}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-brand px-3.5 text-body font-semibold text-brand-on shadow-[0_1px_2px_rgb(31_41_55/0.15)] hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <HugeiconsIcon icon={ShoppingBag01Icon} size={18} aria-hidden />
          {c.myOrder}
        </Link>
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
