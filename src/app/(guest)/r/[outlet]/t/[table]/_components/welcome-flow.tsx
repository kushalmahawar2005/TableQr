"use client";

import { ArrowLeft01Icon, ArrowRight02Icon, Loading03Icon, SquareLock02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useActionState, useMemo, useState, type CSSProperties } from "react";
import type { Lang } from "@/lib/i18n";
import { setLanguage, startInLanguage } from "../actions";
import { g1Copy } from "../_copy";
import { JoinCodeCta } from "./join-code-cta";
import { OutletLogo } from "./outlet-logo";
import { PrimaryButton } from "./start-cta";

const LANGS: { lang: Lang; name: string; hint: string }[] = [
  { lang: "en", name: "English", hint: "Menu in English" },
  { lang: "hi", name: "हिन्दी", hint: "मेन्यू हिन्दी में" },
];

/**
 * First visit to a free or open table: a welcome card, then the language, then straight to the
 * menu. The language choice is what starts or joins the table, so it is one tap, not two.
 */
export function WelcomeFlow({
  outlet,
  table,
  people,
  cta,
  lang,
  shortCode,
  style,
  preview,
  initialStep = "welcome",
}: {
  outlet: { code: string; name: string; logoUrl: string | null; subline: string; poweredBy: boolean };
  table: { code: string; zone: string };
  /** Who is already at the table, when joining */
  people?: string;
  cta: "start" | "join" | "code";
  lang: Lang;
  shortCode: string;
  style: CSSProperties;
  preview?: boolean;
  initialStep?: "welcome" | "language";
}) {
  const [step, setStep] = useState<"welcome" | "language" | "code">(initialStep);
  const [picked, setPicked] = useState<Lang>(lang);
  const c = g1Copy[step === "welcome" ? lang : picked];
  const bound = useMemo(() => startInLanguage.bind(null, outlet.code, shortCode), [outlet.code, shortCode]);
  const [state, action, pending] = useActionState(bound, null);

  return (
    <div lang={lang} style={style} className={`flex flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      <main className="flex flex-1 flex-col items-center justify-center py-8">
        {step === "welcome" ? (
          <section className="w-full animate-rise rounded-[24px] border border-line bg-surface px-6 py-8 text-center shadow-[var(--shadow-float)]">
            <div className="flex justify-center">
              <OutletLogo name={outlet.name} logoUrl={outlet.logoUrl} size={80} />
            </div>
            <p className="mt-5 text-caption font-semibold tracking-wide text-muted uppercase">{c.welcome}</p>
            <h1 className="mt-1 font-display text-title font-bold break-words text-ink">{outlet.name}</h1>
            {outlet.subline && <p className="mt-1 text-caption text-muted">{outlet.subline}</p>}
            <p className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-caption font-semibold text-brand-strong">
              {c.table(table.code)} · {table.zone}
            </p>
            {cta === "code" && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-caption font-semibold text-ink">
                <HugeiconsIcon icon={SquareLock02Icon} size={14} aria-hidden />
                {c.pill.codeRequired}
              </p>
            )}
            {people && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-caption text-muted">
                <HugeiconsIcon icon={UserGroupIcon} size={14} aria-hidden />
                {people}
              </p>
            )}
            <div className="mt-6">
              <PrimaryButton label={cta === "start" ? c.orderNow : c.joinTable(table.code)} type="button" arrow onClick={() => setStep("language")} />
            </div>
          </section>
        ) : step === "language" ? (
          <section className="w-full animate-rise">
            <button
              type="button"
              onClick={() => setStep("welcome")}
              disabled={pending}
              className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-body font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden />
              {c.back}
            </button>
            {/* Both languages on the title: the guest has not chosen yet */}
            <h1 className="mt-4 font-display text-title font-bold text-ink">Choose your language</h1>
            <p lang="hi" className="mt-0.5 text-body text-muted">अपनी भाषा चुनें</p>
            <form
              action={preview || cta === "code" ? undefined : action}
              onSubmit={
                cta === "code"
                  ? (e) => {
                      // The code step joins the table; here only the language is remembered
                      e.preventDefault();
                      const chosen = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
                      if (chosen && !preview) void setLanguage(chosen);
                      setStep("code");
                    }
                  : undefined
              }
              className="mt-6 grid gap-3"
            >
              {LANGS.map((l) => {
                const on = l.lang === picked;
                return (
                  <button
                    key={l.lang}
                    type={preview ? "button" : "submit"}
                    name="lang"
                    value={l.lang}
                    lang={l.lang}
                    disabled={pending}
                    onClick={() => setPicked(l.lang)}
                    aria-pressed={on}
                    className={`flex min-h-18 items-center gap-4 rounded-guest border-2 bg-surface px-5 py-4 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-70 ${
                      on ? "border-brand" : "border-line hover:border-ink/30"
                    }`}
                  >
                    <span className={`grid size-11 shrink-0 place-items-center rounded-full font-display text-section font-bold ${on ? "bg-brand text-brand-on" : "bg-brand-soft text-brand-strong"}`}>
                      {l.lang === "en" ? "A" : "अ"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-section font-bold text-ink">{l.name}</span>
                      <span className="block text-caption text-muted">{l.hint}</span>
                    </span>
                    {pending && on ? (
                      <HugeiconsIcon icon={Loading03Icon} size={20} className="shrink-0 animate-spin text-brand" aria-hidden />
                    ) : (
                      <HugeiconsIcon icon={ArrowRight02Icon} size={20} className="shrink-0 text-muted" aria-hidden />
                    )}
                  </button>
                );
              })}
            </form>
            {pending && <p role="status" className="mt-4 text-center text-caption text-muted">{c.opening}</p>}
            {state?.error === "failed" && <p role="alert" className="mt-4 text-center text-caption text-danger">{c.actionError}</p>}
            {state?.error === "ask_staff" && (
              <p role="status" className="mt-4 rounded-cta border border-line bg-surface px-4 py-4 text-center text-body font-semibold text-ink">{c.askStaffToContinue}</p>
            )}
          </section>
        ) : (
          <section className="w-full animate-rise">
            <JoinCodeCta outletCode={outlet.code} shortCode={shortCode} label={c.joinTable(table.code)} lang={picked} preview={preview} />
          </section>
        )}
      </main>
      <div className="pb-[max(20px,env(safe-area-inset-bottom))]">
        {outlet.poweredBy && <p className="text-center text-label text-muted">{c.poweredBy}</p>}
      </div>
    </div>
  );
}
