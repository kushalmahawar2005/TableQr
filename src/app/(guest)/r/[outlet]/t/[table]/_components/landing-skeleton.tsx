import type { Lang } from "@/lib/i18n";
import { g1Copy } from "../_copy";
import { SlowNotice } from "./slow-notice";
import { PrimaryButton } from "./start-cta";

const block = "animate-pulse rounded-input bg-line/60";

/**
 * Shown while the table's live state loads. The button stays disabled and says why, so a guest
 * can never start an order before we know the table is free (G1 slow-network state).
 */
export function LandingSkeleton({ lang }: { lang: Lang }) {
  const c = g1Copy[lang];
  return (
    <div lang={lang} aria-busy className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3 pt-5 pb-2" aria-hidden>
        <span className={`size-11 ${block}`} />
        <div className="flex-1 space-y-2">
          <span className={`block h-4 w-32 ${block}`} />
          <span className={`block h-3 w-44 ${block}`} />
        </div>
      </div>
      <div className="mt-3 rounded-guest border border-line bg-surface p-5" aria-hidden>
        <span className={`block h-3 w-16 ${block}`} />
        <span className={`mt-2 block h-9 w-40 ${block}`} />
        <span className={`mt-2 block h-4 w-28 ${block}`} />
        <span className={`mt-8 block h-9 w-28 rounded-full ${block}`} />
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <PrimaryButton label={c.checking} disabled type="button" />
        <SlowNotice text={c.slow} />
      </div>
    </div>
  );
}
