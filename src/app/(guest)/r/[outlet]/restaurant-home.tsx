"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, Truck, Hotel, QrCode, Utensils } from "lucide-react";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";
import type { getRestaurantHome } from "@/server/guest/restaurant-home";
import { OutletLogo } from "./t/[table]/_components/outlet-logo";

type HomeData = Awaited<ReturnType<typeof getRestaurantHome>>;

export function RestaurantHome({ data, initialLang = "en" }: { data: HomeData; initialLang?: Lang }) {
  const [step, setStep] = useState<"welcome" | "language" | "service">("welcome");
  const [hindi, setHindi] = useState(initialLang === "hi");
  const { outlet, services } = data;
  const copy = hindi ? {
    choose: "आप क्या करना चाहेंगे?", dine: "रेस्टोरेंट में खाना", dineHint: "अपने फोन के कैमरे से टेबल पर लगा QR स्कैन करें।", booking: "पार्टी के लिए टेबल बुक करें", bookingHint: "तारीख, समय और मेहमानों की संख्या चुनें।", rooms: "होटल रूम सर्विस", roomsHint: "अपने कमरे का QR स्कैन करें।",
  } : {
    choose: "How would you like to continue?", dine: "Dine in", dineHint: "Scan the QR code on your table with your phone camera to open the menu.", booking: "Reserve for a party", bookingHint: "Choose a date, time and party size.", rooms: "Hotel room service", roomsHint: "Scan the QR code in your room.",
  };
  const card = "flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-brand hover:bg-brand-soft/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const infoCard = "flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left";
  return <main lang={hindi ? "hi" : "en"} className="flex min-h-dvh flex-col justify-center py-8 text-ink">
    <section className="rounded-3xl border border-line bg-surface p-6 text-center shadow-[var(--shadow-float)] sm:p-8">
      <div className="flex justify-center"><OutletLogo name={outlet.name} logoUrl={outlet.logoUrl} size={80} /></div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[.16em] text-muted">{hindi ? "स्वागत है" : "Welcome to"}</p>
      <h1 className="mt-1 break-words font-display text-3xl font-bold">{outlet.name}</h1>
      {outlet.city && <p className="mt-1 text-sm text-muted">{outlet.city}</p>}
      {step === "welcome" && <div className="mt-7"><p className="text-sm text-muted">{hindi ? "मेन्यू देखने, टेबल बुक करने या रूम सर्विस के लिए आगे बढ़ें।" : "Continue to browse the menu, reserve a table, or open room service."}</p><button type="button" onClick={() => setStep("language")} className="mt-5 min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on">{hindi ? "आगे बढ़ें" : "Continue"} <span aria-hidden>→</span></button></div>}
      {step === "language" && <div className="mt-7 text-left"><button type="button" onClick={() => setStep("welcome")} className="min-h-10 text-sm font-semibold text-muted">← {hindi ? "वापस" : "Back"}</button><h2 className="mt-3 text-xl font-bold">{hindi ? "अपनी भाषा चुनें" : "Choose your language"}</h2><p className="text-sm text-muted">Choose a language / अपनी भाषा चुनें</p><div className="mt-4 grid gap-3">{([{ hi: false, title: "English", hint: "Menu in English" }, { hi: true, title: "हिन्दी", hint: "मेन्यू हिन्दी में" }] as const).map(option => <button key={option.title} type="button" onClick={() => { setHindi(option.hi); document.cookie = `${LANG_COOKIE}=${option.hi ? "hi" : "en"}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; setStep("service"); }} className={`${card} ${hindi === option.hi ? "border-brand" : ""}`}><span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand-strong">{option.hi ? "अ" : "A"}</span><span className="flex-1"><span className="block font-semibold">{option.title}</span><span className="mt-0.5 block text-sm text-muted">{option.hint}</span></span><span aria-hidden>→</span></button>)}</div></div>}
      {step === "service" && <><div className="mt-7 flex items-center justify-between gap-2"><button type="button" onClick={() => setStep("language")} className="min-h-10 text-sm font-semibold text-muted">← {hindi ? "वापस" : "Back"}</button><h2 className="text-right text-lg font-bold">{copy.choose}</h2></div><div className="mt-3 grid gap-3">
        {services.dineIn && <div className={infoCard}><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Utensils size={21} /></span><span><span className="block font-semibold">{copy.dine}</span><span className="mt-0.5 block text-sm text-muted">{copy.dineHint}</span></span></div>}
        {services.reservations && <Link href={`/r/${encodeURIComponent(outlet.code)}/book?lang=${hindi ? "hi" : "en"}`} className={card}><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><CalendarDays size={21} /></span><span><span className="block font-semibold">{copy.booking}</span><span className="mt-0.5 block text-sm text-muted">{copy.bookingHint}</span></span></Link>}
        {services.delivery && <Link href={`/r/${encodeURIComponent(outlet.code)}/delivery?lang=${hindi ? "hi" : "en"}`} className={card}><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Truck size={21} /></span><span><span className="block font-semibold">{hindi ? "घर पर डिलीवरी" : "Home delivery"}</span><span className="mt-0.5 block text-sm text-muted">{hindi ? "मेन्यू चुनें और घर पर डिलीवरी मँगाएँ।" : "Choose your food and enter your delivery address."}</span></span></Link>}
        {services.rooms && <div className={infoCard}><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Hotel size={21} /></span><span><span className="block font-semibold">{copy.rooms}</span><span className="mt-0.5 block text-sm text-muted">{copy.roomsHint}</span></span></div>}
      </div>
      {!services.delivery && !services.dineIn && !services.reservations && !services.rooms && <p className="mt-6 text-sm text-muted">Please contact the restaurant for assistance.</p>}</>}
    </section>
    <p className="mt-5 flex items-center justify-center gap-1 text-xs text-muted"><QrCode size={14} aria-hidden />TableQR</p>
  </main>;
}
