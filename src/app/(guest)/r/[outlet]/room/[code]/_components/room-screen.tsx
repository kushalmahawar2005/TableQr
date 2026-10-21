"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClockIcon,
  ArrowRight02Icon,
  BodySoapIcon,
  BubbleChatIcon,
  CheckmarkCircle02Icon,
  CleaningBucketIcon,
  Clock01Icon,
  DropletIcon,
  Restaurant01Icon,
  TowelsIcon,
  TShirtIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { ROOM_REQUEST_LABEL, roomRequestKinds, type RoomRequestKind } from "@/domain/rooms";
import type { Lang } from "@/lib/i18n";
import type { RoomPage } from "@/server/guest/room";
import { LanguageToggle } from "../../../t/[table]/_components/language-toggle";
import { OutletHeader } from "../../../t/[table]/_components/outlet-header";
import { askReception, orderFood } from "../actions";

// A guest's page in a hotel room: order food from the restaurant, or ask reception for
// something with one tap. Everything here works only while the room is checked in.

const ICON: Record<RoomRequestKind, IconSvgElement> = {
  housekeeping: CleaningBucketIcon,
  towels: TowelsIcon,
  water: DropletIcon,
  toiletries: BodySoapIcon,
  laundry: TShirtIcon,
  maintenance: Wrench01Icon,
  wake_up: AlarmClockIcon,
  other: BubbleChatIcon,
};

const COPY = {
  en: {
    language: "Language",
    room: (n: string) => `Room ${n}`,
    hello: (name: string) => `Welcome, ${name}`,
    notIn: { title: "This room is not checked in yet", body: "Please call reception. Once you are checked in, you can order food and ask for anything from here." },
    notFound: { title: "We could not find this room", body: "Please call reception for help." },
    revoked: { title: "This code is no longer active", body: "Please call reception for help." },
    unavailable: { title: "Room service is not available right now", body: "Please call reception." },
    food: "Room service",
    order: "Order food",
    myOrder: "See my order",
    payLater: "Added to your room bill. Pay at check-out.",
    payNow: "Pay when your food arrives.",
    kitchenClosed: "The kitchen is closed right now.",
    need: "Need something?",
    needHelp: "Tap and reception gets it at once.",
    otherPlaceholder: "Write what you need",
    send: "Send",
    sent: "Sent. Reception has it.",
    already: "Reception already has this. It is on the way.",
    yours: "Your requests",
    open: "On the way",
    done: "Done",
  },
  hi: {
    language: "भाषा",
    room: (n: string) => `रूम ${n}`,
    hello: (name: string) => `स्वागत है, ${name}`,
    notIn: { title: "यह रूम अभी चेक-इन नहीं है", body: "कृपया रिसेप्शन को कॉल करें। चेक-इन के बाद आप यहीं से खाना और बाकी चीज़ें मँगा सकते हैं।" },
    notFound: { title: "हमें यह रूम नहीं मिला", body: "कृपया रिसेप्शन को कॉल करें।" },
    revoked: { title: "यह कोड अब चालू नहीं है", body: "कृपया रिसेप्शन को कॉल करें।" },
    unavailable: { title: "रूम सर्विस अभी उपलब्ध नहीं है", body: "कृपया रिसेप्शन को कॉल करें।" },
    food: "रूम सर्विस",
    order: "खाना मँगाएँ",
    myOrder: "मेरा ऑर्डर देखें",
    payLater: "रूम के बिल में जुड़ेगा। चेक-आउट पर भुगतान करें।",
    payNow: "खाना आने पर भुगतान करें।",
    kitchenClosed: "किचन अभी बंद है।",
    need: "कुछ चाहिए?",
    needHelp: "टैप करें, रिसेप्शन को तुरंत पता चल जाएगा।",
    otherPlaceholder: "लिखें आपको क्या चाहिए",
    send: "भेजें",
    sent: "भेज दिया। रिसेप्शन को मिल गया।",
    already: "रिसेप्शन के पास यह पहले से है। आ रहा है।",
    yours: "आपकी माँगें",
    open: "आ रहा है",
    done: "हो गया",
  },
} as const;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function RoomScreen({ data, lang, outletCode, shortCode }: { data: Exclude<RoomPage, { kind: "table" }>; lang: Lang; outletCode: string; shortCode: string }) {
  const c = COPY[lang];
  if (data.kind === "error") {
    const m = data.code === "qr_revoked" ? c.revoked : data.code === "outlet_unavailable" ? c.unavailable : c.notFound;
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 py-10 text-center">
        <h1 className="font-display text-title font-bold text-ink">{m.title}</h1>
        <p className="text-body text-muted">{m.body}</p>
      </main>
    );
  }
  return <Room data={data} lang={lang} outletCode={outletCode} shortCode={shortCode} />;
}

function Room({ data, lang, outletCode, shortCode }: { data: Extract<RoomPage, { kind: "room" }>; lang: Lang; outletCode: string; shortCode: string }) {
  const c = COPY[lang];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string; at: "food" | "need" } | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const { outlet, room, stay } = data;
  const style = brandStyle(deriveBrandTokens(outlet.accentColor)) as CSSProperties;
  const base = `/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}`;

  const ask = (kind: RoomRequestKind, note: string | null = null) =>
    start(async () => {
      const r = await askReception(outletCode, shortCode, kind, note);
      if (r && "error" in r) setNotice({ ok: false, text: r.error, at: "need" });
      else {
        setNotice({ ok: true, text: r?.repeated ? c.already : c.sent, at: "need" });
        setOther(null);
        router.refresh();
      }
    });
  const order = () =>
    start(async () => {
      const r = await orderFood(outletCode, shortCode);
      if (r && "error" in r) setNotice({ ok: false, text: r.error, at: "food" });
    });

  return (
    <div lang={lang} style={style} className="flex min-h-dvh flex-col pb-10">
      <OutletHeader name={outlet.name} logoUrl={outlet.logoUrl} subline={outlet.city} aside={<LanguageToggle lang={lang} label={c.language} />} />

      <section className="mt-3 rounded-card border border-brand-border bg-brand-soft px-5 py-4">
        <p className="font-display text-title font-bold text-brand-strong">{c.room(room.number)}</p>
        <p className="text-body text-ink">{stay ? c.hello(stay.firstName) : room.roomType ?? ""}</p>
      </section>

      {!stay ? (
        <section className="mt-4 rounded-card border border-line bg-surface px-5 py-6 text-center">
          <h1 className="font-display text-section font-bold text-ink">{c.notIn.title}</h1>
          <p className="mt-1 text-body text-muted">{c.notIn.body}</p>
        </section>
      ) : (
        <>
          <section className="mt-4 rounded-card border border-line bg-surface p-5" aria-labelledby="food">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand-strong"><HugeiconsIcon icon={Restaurant01Icon} size={22} aria-hidden /></span>
              <div>
                <h2 id="food" className="font-display text-section font-bold text-ink">{c.food}</h2>
                <p className="text-caption text-muted">{outlet.isOpen ? (stay.foodPay === "at_checkout" ? c.payLater : c.payNow) : c.kitchenClosed}</p>
              </div>
            </div>
            {stay.joined ? (
              <Link href={`${base}/menu`} className={`mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-cta bg-brand px-5 text-button font-semibold text-brand-on hover:bg-brand-hover ${focus}`}>
                {c.order}
                <HugeiconsIcon icon={ArrowRight02Icon} size={20} aria-hidden />
              </Link>
            ) : (
              <button type="button" disabled={pending || !outlet.isOpen} onClick={order} className={`mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-cta bg-brand px-5 text-button font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-60 ${focus}`}>
                {c.order}
                <HugeiconsIcon icon={ArrowRight02Icon} size={20} aria-hidden />
              </button>
            )}
            {stay.joined && <Link href={`${base}/orders`} className={`mt-2 flex min-h-11 items-center justify-center text-body font-semibold text-brand-strong ${focus}`}>{c.myOrder}</Link>}
            {notice?.at === "food" && <Notice ok={notice.ok} text={notice.text} />}
          </section>

          <section className="mt-4 rounded-card border border-line bg-surface p-5" aria-labelledby="need">
            <h2 id="need" className="font-display text-section font-bold text-ink">{c.need}</h2>
            <p className="text-caption text-muted">{c.needHelp}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {roomRequestKinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={pending}
                  onClick={() => (k === "other" ? setOther(other === null ? "" : null) : ask(k))}
                  className={`flex min-h-16 flex-col items-start justify-center gap-1 rounded-cta border border-line px-3 py-2.5 text-left text-body font-semibold text-ink hover:bg-ink/[0.04] disabled:opacity-60 ${focus} ${k === "other" && other !== null ? "border-brand bg-brand-soft" : ""}`}
                >
                  <HugeiconsIcon icon={ICON[k]} size={20} className="text-brand-strong" aria-hidden />
                  {ROOM_REQUEST_LABEL[k][lang]}
                </button>
              ))}
            </div>
            {other !== null && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (other.trim()) ask("other", other);
                }}
              >
                <input value={other} onChange={(e) => setOther(e.target.value)} maxLength={140} autoFocus placeholder={c.otherPlaceholder} aria-label={c.otherPlaceholder} className={`h-12 min-w-0 flex-1 rounded-cta border border-line bg-surface px-3 text-body text-ink ${focus}`} />
                <button type="submit" disabled={pending || !other.trim()} className={`h-12 rounded-cta bg-brand px-4 text-button font-semibold text-brand-on disabled:opacity-60 ${focus}`}>{c.send}</button>
              </form>
            )}
            {/* Shown right under the buttons: the guest has scrolled down here to tap */}
            {notice?.at === "need" && <Notice ok={notice.ok} text={notice.text} />}
          </section>

          {stay.requests.length > 0 && (
            <section className="mt-4 rounded-card border border-line bg-surface p-5" aria-labelledby="yours">
              <h2 id="yours" className="font-display text-section font-bold text-ink">{c.yours}</h2>
              <ul className="mt-2 divide-y divide-line">
                {stay.requests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-body">
                    <span className="text-ink">{ROOM_REQUEST_LABEL[r.kind][lang]}</span>
                    <span className={`inline-flex items-center gap-1 text-caption font-semibold ${r.status === "done" ? "text-[var(--state-available-text)]" : "text-muted"}`}>
                      <HugeiconsIcon icon={r.status === "done" ? CheckmarkCircle02Icon : Clock01Icon} size={16} aria-hidden />
                      {r.status === "done" ? c.done : c.open}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Notice({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p role="status" className={`mt-3 rounded-cta px-4 py-3 text-body font-semibold ${ok ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-danger/10 text-danger"}`}>
      {text}
    </p>
  );
}
