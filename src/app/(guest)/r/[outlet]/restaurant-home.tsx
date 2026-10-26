"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, Calendar03Icon, CheckmarkCircle02Icon, DeliveryTruck01Icon, Location01Icon, QrCodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";
import type { getRestaurantHome } from "@/server/guest/restaurant-home";
import { InstallApp } from "@/components/install-app";
import { OutletLogo } from "./t/[table]/_components/outlet-logo";

type HomeData = Awaited<ReturnType<typeof getRestaurantHome>>;
type Step = "welcome" | "language" | "service";
const STEPS: Step[] = ["welcome", "language", "service"];

const LANGS = [
  { hi: false, glyph: "Aa", title: "English", hint: "Menu in English" },
  { hi: true, glyph: "अ", title: "हिन्दी", hint: "मेन्यू हिन्दी में" },
] as const;

/** Remembered for a year, so the booking and delivery pages open in the same language */
function rememberLanguage(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

/** The restaurant's own page (no table): a welcome, the language, then booking or delivery. */
export function RestaurantHome({ data, initialLang = "en", installable = null }: { data: HomeData; initialLang?: Lang; installable?: { name: string; logoUrl: string | null } | null }) {
  const [step, setStep] = useState<Step>("welcome");
  const [hindi, setHindi] = useState(initialLang === "hi");
  const { outlet, services } = data;
  const t = hindi
    ? {
        welcome: "स्वागत है", intro: "पार्टी के लिए टेबल बुक करें या घर पर खाना मँगाएँ।", next: "आगे बढ़ें", back: "वापस",
        choose: "आप क्या करना चाहेंगे?", chooseNote: "नीचे से एक विकल्प चुनें।", booking: "पार्टी के लिए टेबल बुक करें", bookingHint: "तारीख, समय और मेहमानों की संख्या चुनें।",
        delivery: "घर पर डिलीवरी", deliveryHint: "मेन्यू चुनें और घर पर डिलीवरी मँगाएँ।", none: "ऑनलाइन बुकिंग और डिलीवरी अभी उपलब्ध नहीं हैं। टेबल या रूम QR स्कैन करें।",
        announcement: "घोषणा", step: (n: number) => `चरण ${n} / 3`, poweredBy: "TableQR द्वारा",
      }
    : {
        welcome: "Welcome to", intro: "Reserve a table for your party or order food for delivery.", next: "Continue", back: "Back",
        choose: "How would you like to continue?", chooseNote: "Pick one to get started.", booking: "Reserve for a party", bookingHint: "Choose a date, time and party size.",
        delivery: "Home delivery", deliveryHint: "Choose your food and enter your delivery address.", none: "Online reservations and delivery are not available. Scan your table or room QR instead.",
        announcement: "Announcement", step: (n: number) => `Step ${n} of 3`, poweredBy: "Powered by TableQR",
      };
  const style = brandStyle(deriveBrandTokens(outlet.accentColor)) as CSSProperties;

  const pickLanguage = (hi: boolean) => {
    setHindi(hi);
    rememberLanguage(hi ? "hi" : "en");
    setStep("service");
  };

  return (
    <main lang={hindi ? "hi" : "en"} style={style} className="flex min-h-dvh flex-col justify-center py-8 text-ink">
      <section className="overflow-hidden rounded-[28px] border border-line/60 bg-surface shadow-[0_18px_50px_-20px_rgb(31_41_55/0.28)]">
        <div className="px-6 pt-8 pb-7 text-center sm:px-8">
          <div className="flex justify-center">
            <OutletLogo name={outlet.name} logoUrl={outlet.logoUrl} size={80} />
          </div>
          <p className="mt-4 text-label font-semibold tracking-[.18em] text-muted uppercase">{t.welcome}</p>
          <h1 className="mt-1 font-display text-[1.875rem] leading-tight font-bold tracking-tight break-words">{outlet.name}</h1>
          {outlet.city && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-caption text-muted">
              <HugeiconsIcon icon={Location01Icon} size={14} aria-hidden />
              {outlet.city}
            </p>
          )}

          {outlet.announcement && (
            <aside aria-label={t.announcement} className="mt-5 rounded-2xl border border-brand-border/60 bg-brand-soft/70 p-4 text-left">
              <p className="text-caption font-bold text-brand-strong">{outlet.announcement.title}</p>
              <p className="mt-1 text-caption leading-relaxed whitespace-pre-wrap text-ink">{outlet.announcement.body}</p>
            </aside>
          )}

          {/* Where the guest is in the three steps */}
          <div className="mt-6 flex items-center justify-center gap-1.5" role="img" aria-label={t.step(STEPS.indexOf(step) + 1)}>
            {STEPS.map((s) => (
              <span key={s} className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? "w-6 bg-brand" : STEPS.indexOf(s) < STEPS.indexOf(step) ? "w-1.5 bg-brand/50" : "w-1.5 bg-line"}`} />
            ))}
          </div>

          {step === "welcome" && (
            <div className="mt-5 animate-rise">
              <p className="mx-auto max-w-[300px] text-body text-muted">{t.intro}</p>
              <button
                type="button"
                onClick={() => setStep("language")}
                className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-button font-bold text-brand-on shadow-[0_8px_20px_-6px_var(--brand-border)] transition-[transform,background-color] duration-100 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98]"
              >
                {t.next}
                <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={2.4} aria-hidden />
              </button>
            </div>
          )}

          {step === "language" && (
            <div className="mt-5 animate-rise text-left">
              <StepHeader back={t.back} onBack={() => setStep("welcome")} title="Choose your language" note={<span lang="hi">अपनी भाषा चुनें</span>} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                {LANGS.map((option) => {
                  const on = hindi === option.hi;
                  return (
                    <button
                      key={option.title}
                      type="button"
                      lang={option.hi ? "hi" : "en"}
                      aria-pressed={on}
                      onClick={() => pickLanguage(option.hi)}
                      className={`relative flex flex-col items-start gap-3 rounded-2xl border-2 bg-surface p-4 text-left transition-[border-color,transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] ${
                        on ? "border-brand shadow-[0_8px_20px_-10px_var(--brand-border)]" : "border-line/70 hover:border-ink/25"
                      }`}
                    >
                      <span className={`grid size-12 place-items-center rounded-xl font-display text-[1.375rem] font-bold ${on ? "bg-brand text-brand-on" : "bg-brand-soft text-brand-strong"}`}>{option.glyph}</span>
                      <span>
                        <span className="block text-section font-bold">{option.title}</span>
                        <span className="mt-0.5 block text-caption text-muted">{option.hint}</span>
                      </span>
                      {on && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} className="absolute top-3 right-3 text-brand" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === "service" && (
            <div className="mt-5 animate-rise text-left">
              <StepHeader back={t.back} onBack={() => setStep("language")} title={t.choose} note={t.chooseNote} />
              <div className="mt-4 grid gap-3">
                {services.reservations && (
                  <ServiceCard href={`/r/${encodeURIComponent(outlet.code)}/book?lang=${hindi ? "hi" : "en"}`} icon={Calendar03Icon} title={t.booking} hint={t.bookingHint} />
                )}
                {services.delivery && (
                  <ServiceCard href={`/r/${encodeURIComponent(outlet.code)}/delivery?lang=${hindi ? "hi" : "en"}`} icon={DeliveryTruck01Icon} title={t.delivery} hint={t.deliveryHint} />
                )}
              </div>
              {!services.delivery && !services.reservations && (
                <p className="mt-4 flex items-start gap-2 rounded-2xl border border-line bg-paper p-4 text-caption text-muted">
                  <HugeiconsIcon icon={QrCodeIcon} size={18} className="mt-px shrink-0" aria-hidden />
                  {t.none}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
      {installable && <div className="mt-4"><InstallApp name={installable.name} logoUrl={installable.logoUrl} /></div>}
      <p className="mt-5 flex items-center justify-center gap-1.5 text-label text-muted">
        <HugeiconsIcon icon={QrCodeIcon} size={14} aria-hidden />
        {t.poweredBy}
      </p>
    </main>
  );
}

function StepHeader({ back, onBack, title, note }: { back: string; onBack: () => void; title: string; note: ReactNode }) {
  return (
    <div>
      {/* Drawn small, with a 44px tap area */}
      <button
        type="button"
        onClick={onBack}
        className="relative -ml-1 inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-caption font-semibold text-muted before:absolute before:-inset-2.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={2} aria-hidden />
        {back}
      </button>
      <h2 className="mt-2.5 font-display text-section leading-tight font-bold">{title}</h2>
      <p className="mt-0.5 text-caption text-muted">{note}</p>
    </div>
  );
}

function ServiceCard({ href, icon, title, hint }: { href: string; icon: IconSvgElement; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-24 items-center gap-4 rounded-2xl border-2 border-line/70 bg-surface p-4 transition-[border-color,transform] duration-150 hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.99]"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
        <HugeiconsIcon icon={icon} size={22} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-bold">{title}</span>
        <span className="mt-0.5 block text-caption text-muted">{hint}</span>
      </span>
      <HugeiconsIcon icon={ArrowRight01Icon} size={20} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
    </Link>
  );
}
