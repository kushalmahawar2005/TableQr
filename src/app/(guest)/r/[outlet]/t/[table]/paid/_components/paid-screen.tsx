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
export type PaidPreview = { offline?: boolean; justRated?: boolean; sent?: string; picked?: number; comment?: string };

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
  const [picked, setPicked] = useState<number | null>(preview?.picked ?? null);
  const [comment, setComment] = useState(preview?.comment ?? "");
  const [rateError, setRateError] = useState(false);
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

  async function rate() {
    if (picked === null) return;
    if (preview) {
      setRating(picked);
      setJustRated(true);
      return;
    }
    if (busy.current || rating !== null || !online) return;
    busy.current = true;
    setRateError(false);
    const res = await rateAction(initial.outlet.code, shortCode, picked, comment).catch(() => null);
    busy.current = false;
    if (res?.ok) {
      setRating(res.rating);
      setJustRated(true);
    } else setRateError(true);
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
  const closed = data.state === "closed";
  // Straight after the last share is paid it is "All settled"; coming back later it is a summary
  const later = closed && data.closedAt !== null && data.renderedAt - data.closedAt > 30 * 60_000;
  const closedWhen =
    data.closedAt === null
      ? ""
      : new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: data.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(data.closedAt);
  const total = formatRupees(data.paidPaise + data.tipPaise);
  return (
    <div lang={lang} style={style} className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      {header}
      <main className="pb-8">
        {!online && (
          <p role="status" className="mt-4 flex items-start gap-3 rounded-guest border border-line bg-surface px-4 py-3 text-body">
            <HugeiconsIcon icon={WifiOff01Icon} size={20} className="mt-px shrink-0" aria-hidden />
            <span>
              <span className="block font-semibold">{c.offline}</span>
              <span className="text-caption text-muted">{c.offlineBody}</span>
            </span>
          </p>
        )}

        {later ? (
          <section className="mt-8">
            <h1 className="font-display text-title font-bold text-ink">{c.summaryTitle}</h1>
            <p className="mt-2 text-body text-muted">
              {closedWhen && `${c.closedOn(closedWhen)} `}
              {c.stillFor24h}
            </p>
            {paid && <p className="mt-3 text-body font-semibold text-ink tabular">{c.youPaid(total)}</p>}
          </section>
        ) : closed || paid ? (
          <section className="mt-8 animate-rise text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--state-available-soft)] text-success" aria-hidden>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={34} />
            </span>
            {closed ? (
              <>
                <h1 className="mt-4 font-display text-display font-bold text-ink">{c.allSettled}</h1>
                <p className="mt-2 text-section text-ink">{c.allSettledBody}</p>
                <p className="mt-1 text-body text-muted">
                  {c.tableClosed(data.table.code)}
                  {paid && ` ${c.youPaid(total)}`}
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-4 font-display text-display font-bold text-ink tabular">{c.paid(total)}</h1>
                {data.tipPaise > 0 && <p className="mt-1 text-caption text-muted">{c.billAndTip(formatRupees(data.paidPaise), formatRupees(data.tipPaise))}</p>}
                <p className="mt-2 text-section text-ink">{c.thanks(data.me.name)}</p>
                {data.paidFor.length > 0 && <p className="mt-1 text-body text-muted">{c.paidFor(names(data.paidFor))}</p>}
              </>
            )}
          </section>
        ) : (
          <section className="mt-8 rounded-guest border border-line bg-surface p-4">
            <h1 className="font-display text-title font-bold text-ink">{c.notPaidTitle}</h1>
            <p className="mt-1 text-body text-muted">{c.notPaidBody}</p>
            <Link href={`${base}/bill`} className={`mt-3 inline-flex min-h-11 items-center font-semibold text-brand-strong underline underline-offset-4 ${focusRing}`}>
              {c.goToBill}
            </Link>
          </section>
        )}

        {/* Table progress: compact, never singling anyone out beyond who the table waits for */}
        <section aria-labelledby="g9-progress" className="mt-6 rounded-guest border border-line bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="g9-progress" className="text-body font-semibold text-ink">
              {c.progress(data.progress.paid, data.progress.total)}
            </h2>
            {closed && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} className="shrink-0 text-success" aria-hidden />}
          </div>
          <div className="mt-2 flex gap-1" aria-hidden>
            {Array.from({ length: data.progress.total }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < data.progress.paid ? "bg-success" : "bg-line"}`} />
            ))}
          </div>
          {!closed && data.progress.people.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {data.progress.people.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 text-body">
                  <span className="min-w-0 break-words text-ink">{p.isMe ? (p.name ? `${p.name} (${c.you})` : c.you) : (p.name ?? c.anotherGuest)}</span>
                  <span className={`text-caption font-semibold ${p.paid ? "text-[var(--state-available-text)]" : "text-muted"}`}>{p.paid ? c.paidChip : c.unpaidChip}</span>
                </li>
              ))}
            </ul>
          )}
          {!closed && (
            <p className="mt-2.5 border-t border-line pt-2.5 text-caption text-muted">
              {data.waitingFor.length > 0 && <span className="font-semibold text-ink">{c.waitingFor(names(data.waitingFor))} </span>}
              {c.staysOpen}
            </p>
          )}
        </section>

        {/* Receipt: the document itself, plus delivery only on channels that are really set up */}
        {data.receipt.available && (
          <section aria-label={c.receipt} className="mt-4 space-y-2">
            <Link href={`${base}/paid/receipt`} className={`flex min-h-14 items-center justify-center gap-2 rounded-cta border border-line bg-surface px-4 text-body font-semibold text-ink hover:border-ink/40 ${focusRing}`}>
              <HugeiconsIcon icon={Invoice01Icon} size={20} aria-hidden />
              {data.receipt.kind === "tax_invoice" ? c.viewInvoice : closed ? c.viewFinal : c.viewReceipt}
            </Link>
            {data.channels.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(max(96px,7em),1fr))] gap-2">
                {data.channels.map((ch) => (
                  <button key={ch} type="button" onClick={() => void send(ch)} disabled={!online} className={`flex min-h-12 items-center justify-center gap-1.5 rounded-cta border border-line bg-surface px-2 text-caption font-semibold text-ink disabled:opacity-55 ${focusRing}`}>
                    <HugeiconsIcon icon={channelIcon[ch]} size={18} aria-hidden />
                    {c.sendOn[ch]}
                  </button>
                ))}
              </div>
            )}
            {sent && (
              <p role="status" className={`text-center text-caption font-semibold ${sent.error ? "text-danger" : "text-[var(--state-available-text)]"}`}>
                {sent.text}
              </p>
            )}
          </section>
        )}

        {/* Rating: one per person; the review link below is the same for every rating */}
        <section aria-labelledby="g9-rate" className="mt-8 border-t border-line pt-6">
          <h2 id="g9-rate" className="font-display text-section font-bold text-ink">
            {c.rateTitle}
          </h2>
          {rating === null ? (
            <>
              <p className="mt-0.5 text-caption text-muted">{c.rateHelp}</p>
              <div role="radiogroup" aria-labelledby="g9-rate" className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={picked === n}
                    aria-label={c.rateStar(n)}
                    disabled={!online}
                    onClick={() => setPicked(n)}
                    className={`grid size-12 place-items-center rounded-full ${focusRing} ${picked !== null && n <= picked ? "text-[var(--state-held)]" : "text-ink/25 hover:text-ink/40"}`}
                  >
                    <HugeiconsIcon icon={StarIcon} size={30} strokeWidth={1.6} className={picked !== null && n <= picked ? "fill-current" : ""} aria-hidden />
                  </button>
                ))}
              </div>
              {picked !== null && (
                <>
                  <label className="mt-3 block">
                    <span className="text-body font-semibold text-ink">{c.feedbackLabel}</span>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value.slice(0, 500))}
                      rows={3}
                      placeholder={c.feedbackPlaceholder}
                      className="mt-1.5 block w-full resize-y rounded-input border border-line bg-surface px-3 py-2.5 text-body text-ink placeholder:text-muted/80 focus:border-brand focus:outline-none"
                    />
                  </label>
                  <button type="button" onClick={() => void rate()} disabled={!online} className={`mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-cta bg-brand px-4 text-button font-semibold text-brand-on disabled:opacity-55 ${focusRing}`}>
                    {c.submit}
                  </button>
                  {rateError && (
                    <p role="alert" className="mt-2 text-caption font-semibold text-danger">
                      {c.failed}
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <div role="status" className="mt-2">
              <p className="flex gap-0.5 text-[var(--state-held)]" aria-hidden>
                {[1, 2, 3, 4, 5].map((n) => (
                  <HugeiconsIcon key={n} icon={StarIcon} size={22} strokeWidth={1.6} className={n <= rating ? "fill-current" : "text-ink/20"} />
                ))}
              </p>
              <p className="mt-1.5 text-body text-ink">{justRated ? c.rated : c.yourRating(rating)}</p>
              {justRated && <p className="sr-only">{c.yourRating(rating)}</p>}
            </div>
          )}
        </section>

        {data.reviewUrl && (
          <section className="mt-5">
            <a href={data.reviewUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-12 items-center gap-2 rounded-cta border border-line bg-surface px-4 text-body font-semibold text-ink hover:border-ink/40 ${focusRing}`}>
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
