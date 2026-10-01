"use client";

import {
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Invoice01Icon,
  LinkSquare02Icon,
  Mail01Icon,
  Message01Icon,
  StarIcon,
  WhatsappIcon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { formatRupees } from "@/domain/menu-price";
import type { Lang } from "@/lib/i18n";
import { connectRealtime } from "@/lib/realtime-client";
import type { AfterVisitData } from "@/server/guest/after-visit";
import { DiningNav } from "../../_components/dining-nav";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { focusRing } from "../../_components/sheet";
import { billTokenAction } from "../../bill/actions";
import { afterVisitAction, rateAction, sendReceiptAction } from "../actions";
import { g9Copy } from "../_copy";

/** A frozen state for the dev review board */
export type PaidPreview = { offline?: boolean; justRated?: boolean; sent?: string };

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

const channelIcon = { whatsapp: WhatsappIcon, sms: Message01Icon, email: Mail01Icon };

export function PaidScreen({ data: initial, lang, shortCode, realtimeUrl, preview }: { data: AfterVisitData; lang: Lang; shortCode: string; realtimeUrl: string | null; preview?: PaidPreview }) {
  const c = g9Copy[lang];
  const [data, setData] = useState(initial);
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true) && !preview?.offline;
  const [rating, setRating] = useState<number | null>(initial.expired ? null : initial.rating);
  const [justRated, setJustRated] = useState(!!preview?.justRated);
  const [sent, setSent] = useState<{ text: string; error?: boolean } | null>(preview?.sent ? { text: c.sent(preview.sent) } : null);
  const busy = useRef(false);
  const base = `/r/${encodeURIComponent(initial.outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const live = !data.expired && data.state === "open";

  const refresh = useCallback(async () => {
    if (preview || !navigator.onLine) return;
    const res = await afterVisitAction(initial.outlet.code, shortCode).catch(() => null);
    if (res?.ok && res.data) setData(res.data);
  }, [initial.outlet.code, preview, shortCode]);

  // While the table is still open, others paying (or the table closing) updates this screen
  useEffect(() => {
    if (preview || !live) return;
    const poll = setInterval(() => document.visibilityState === "visible" && void refresh(), 15_000);
    const stop = connectRealtime({ url: realtimeUrl, getToken: () => billTokenAction(initial.outlet.code, shortCode), onEvents: () => void refresh(), onResync: () => void refresh() });
    return () => {
      clearInterval(poll);
      stop();
    };
  }, [initial.outlet.code, live, preview, realtimeUrl, refresh, shortCode]);

  async function rate(n: number) {
    if (preview) {
      setRating(n);
      setJustRated(true);
      return;
    }
    if (busy.current || rating !== null || !online) return;
    busy.current = true;
    setRating(n);
    const res = await rateAction(initial.outlet.code, shortCode, n).catch(() => null);
    busy.current = false;
    if (res?.ok) {
      setRating(res.rating);
      setJustRated(true);
    } else setRating(null);
  }

  async function send(channel: "whatsapp" | "sms" | "email") {
    if (preview || busy.current || !online) return;
    busy.current = true;
    const res = await sendReceiptAction(initial.outlet.code, shortCode, channel).catch(() => null);
    busy.current = false;
    setSent(res?.ok && res.destination ? { text: c.sent(res.destination) } : { text: c.sendFailed, error: true });
  }

  const header = (
    <header className="flex items-center gap-3 pt-4">
      <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={40} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-section font-bold break-words text-ink">{data.outlet.name}</p>
        <p className="text-caption text-muted">{c.tableLine(data.table.code)}</p>
      </div>
      <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
    </header>
  );
  const style = brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties;

  if (data.expired) {
    return (
      <div lang={lang} style={style} className={`flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
        {header}
        <main className="mt-16 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-surface text-muted ring-1 ring-line" aria-hidden>
            <HugeiconsIcon icon={Clock01Icon} size={26} />
          </span>
          <h1 className="mt-4 font-display text-title font-bold text-ink">{c.expiredTitle}</h1>
          <p className="mt-2 text-body text-muted">{c.expiredBody}</p>
        </main>
      </div>
    );
  }

  const paid = data.paidPaise > 0;
  const names = (list: (string | null)[]) => list.map((n) => n ?? c.anotherGuest).join(", ");
  return (
    <div lang={lang} style={style} className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      {header}
      <main className="pb-6">
        {!online && (
          <p role="status" className="mt-4 flex items-start gap-3 rounded-guest border border-line bg-surface px-4 py-3 text-body">
            <HugeiconsIcon icon={WifiOff01Icon} size={20} className="mt-px shrink-0" aria-hidden />
            <span>
              <span className="block font-semibold">{c.offline}</span>
              <span className="text-caption text-muted">{c.offlineBody}</span>
            </span>
          </p>
        )}

        {paid ? (
          <section className="mt-8 animate-rise text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--state-available-soft)] text-success" aria-hidden>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={34} />
            </span>
            <h1 className="mt-4 font-display text-display font-bold text-ink tabular">{c.paid(formatRupees(data.paidPaise + data.tipPaise))}</h1>
            {data.tipPaise > 0 && <p className="mt-1 text-caption text-muted">{c.billAndTip(formatRupees(data.paidPaise), formatRupees(data.tipPaise))}</p>}
            <p className="mt-2 text-section text-ink">{c.thanks(data.me.name)}</p>
            {data.paidFor.length > 0 && <p className="mt-1 text-body text-muted">{c.paidFor(names(data.paidFor))}</p>}
          </section>
        ) : (
          <section className="mt-8 rounded-guest border border-line bg-surface p-4">
            <h1 className="font-display text-title font-bold text-ink">{data.allSettled ? c.allSettled : c.notPaidTitle}</h1>
            <p className="mt-1 text-body text-muted">{data.allSettled ? c.allSettledBody : c.notPaidBody}</p>
            {!data.allSettled && (
              <Link href={`${base}/bill`} className={`mt-3 inline-flex min-h-11 items-center font-semibold text-brand-strong underline underline-offset-4 ${focusRing}`}>
                {c.goToBill}
              </Link>
            )}
          </section>
        )}

        {/* Table progress */}
        <section aria-label={c.progress(data.progress.paid, data.progress.total)} className="mt-6 rounded-guest border border-line bg-surface p-4">
          <p className="flex items-center justify-between gap-3 text-body font-semibold text-ink">
            {data.allSettled ? c.allSettled : c.progress(data.progress.paid, data.progress.total)}
            {data.allSettled && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} className="text-success" aria-hidden />}
          </p>
          <div className="mt-2 flex gap-1" aria-hidden>
            {Array.from({ length: data.progress.total }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < data.progress.paid ? "bg-success" : "bg-line"}`} />
            ))}
          </div>
          <p className="mt-2 text-caption text-muted">
            {data.allSettled ? c.allSettledBody : `${data.waitingFor.length ? `${c.waitingFor(names(data.waitingFor))} ` : ""}${c.staysOpen}`}
          </p>
        </section>

        {/* Receipt */}
        {data.receipt.available && (
          <section aria-label={c.receipt} className="mt-4 grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">
            {data.channels.map((ch) => (
              <button key={ch} type="button" onClick={() => void send(ch)} disabled={!online} className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-guest border border-line bg-surface px-2 py-2 text-caption font-semibold text-ink disabled:opacity-55 ${focusRing}`}>
                <HugeiconsIcon icon={channelIcon[ch]} size={20} aria-hidden />
                {c.sendOn[ch]}
              </button>
            ))}
            <Link href={`${base}/paid/receipt`} className={`col-span-2 flex min-h-16 items-center justify-center gap-2 rounded-guest border border-line bg-surface px-3 text-body font-semibold text-ink ${focusRing} ${data.channels.length ? "" : "min-[360px]:col-span-4"}`}>
              <HugeiconsIcon icon={Invoice01Icon} size={20} aria-hidden />
              {data.receipt.kind === "tax_invoice" ? c.viewInvoice : c.viewReceipt}
            </Link>
          </section>
        )}
        {sent && (
          <p role="status" className={`mt-2 text-center text-caption font-semibold ${sent.error ? "text-danger" : "text-success"}`}>
            {sent.text}
          </p>
        )}

        {/* Rating: one tap; the review link below is the same for everyone */}
        <section aria-labelledby="g9-rate" className="mt-7 text-center">
          <h2 id="g9-rate" className="font-display text-section font-bold text-ink">
            {c.rateTitle}
          </h2>
          <div role="radiogroup" aria-labelledby="g9-rate" className="mt-2 flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={c.rateStar(n)}
                disabled={rating !== null || !online}
                onClick={() => void rate(n)}
                className={`grid size-12 place-items-center rounded-full ${focusRing} ${rating !== null && n <= rating ? "text-[var(--state-held)]" : "text-line"} disabled:cursor-default`}
              >
                <HugeiconsIcon icon={StarIcon} size={30} strokeWidth={1.6} className={rating !== null && n <= rating ? "fill-current" : ""} aria-hidden />
              </button>
            ))}
          </div>
          {rating !== null && justRated && (
            <p role="status" className="mt-1 text-caption text-muted">
              {c.rated}
            </p>
          )}
        </section>

        {data.reviewUrl && (
          <section className="mt-5 text-center">
            <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-12 items-center gap-2 rounded-cta border border-line bg-surface px-4 text-body font-semibold text-ink ${focusRing}`}>
              <HugeiconsIcon icon={LinkSquare02Icon} size={18} aria-hidden />
              {c.review}
            </a>
            <p className="mt-1.5 text-caption text-muted">{c.reviewNote}</p>
          </section>
        )}

        {data.bookingUrl && (
          <Link href={data.bookingUrl} className={`mt-6 flex min-h-14 items-center justify-center gap-2 rounded-cta bg-brand px-4 text-button font-semibold text-brand-on ${focusRing}`}>
            <HugeiconsIcon icon={Calendar03Icon} size={18} aria-hidden />
            {c.book}
          </Link>
        )}
      </main>
      {live && <DiningNav tablePath={base} active="bill" lang={lang} preview={!!preview} />}
    </div>
  );
}
