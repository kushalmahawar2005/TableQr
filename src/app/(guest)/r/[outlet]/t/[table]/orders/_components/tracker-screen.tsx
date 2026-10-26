"use client";

import {
  AlertCircleIcon,
  ArrowRight01Icon,
  ChefHatIcon,
  LeftToRightListBulletIcon,
  Note01Icon,
  ServingFoodIcon,
  ShoppingBasket01Icon,
  Tick02Icon,
  BellRingIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CleanIcon,
  Clock01Icon,
  GlassWaterIcon,
  InformationCircleIcon,
  Invoice01Icon,
  Loading03Icon,
  Notification01Icon,
  Restaurant01Icon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { formatRupees } from "@/domain/menu-price";
import { menuThumb } from "@/domain/menu-photo";
import type { LineStatus } from "@/domain/kitchen";
import type { Lang } from "@/lib/i18n";
import type { TrackerScreenData } from "@/server/guest/tracker-screen";
import type { ServiceKind } from "@/server/guest/service-requests";
import { DiningNav } from "../../_components/dining-nav";
import { RoomDashboardLink } from "../../_components/room-dashboard-link";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { cancelLineAction, repeatOrderRoundAction, serviceRequestAction } from "../actions";
import { g6Copy, type G6Copy } from "../_copy";
import { useTrackerSync } from "../_hooks/use-tracker-sync";
import { isRoomCode, placeHi } from "@/domain/rooms";

type Round = TrackerScreenData["rounds"][number];
type Line = Round["lines"][number];
export type TrackerPreview = { offline?: boolean; failed?: boolean; confirm?: "cancel" | "bill"; notice?: { text: string; error?: boolean }; tab?: "orders" | "items" };

const steps = ["placed", "accepted", "preparing", "ready"] as const;
const STEP_ICONS = { placed: Note01Icon, accepted: CheckmarkCircle02Icon, preparing: ChefHatIcon, ready: ServingFoodIcon } as const;

const tone: Record<LineStatus, string> = {
  placed: "bg-[#F0F4F8] text-[#1E5F8A] border border-[#D5E3EF]",
  accepted: "bg-[#E8F1FC] text-[#1D58B5] border border-[#CCDFF8]",
  preparing: "bg-[#FFF4E5] text-[#9A6200] border border-[#FDE0B8]",
  ready: "bg-[#FFF0E6] text-[#C44A00] border border-[#FCD2B8]",
  served: "bg-[#EBF7F1] text-[#1D7A4B] border border-[#C6EBD7]",
  cancelled: "bg-[#FDF0ED] text-[#C9382B] border border-[#F8D2CB]",
  voided: "bg-[#F3F4F6] text-muted border border-line",
};

const serviceIcons: Record<ServiceKind, typeof GlassWaterIcon> = {
  water: GlassWaterIcon,
  cutlery: Restaurant01Icon,
  call_waiter: BellRingIcon,
  clean_table: CleanIcon,
  request_bill: Invoice01Icon,
};

const button = "min-h-12 rounded-cta px-4 py-3 text-button font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed";

export function TrackerScreen({
  data: initial,
  lang,
  shortCode,
  realtimeUrl,
  preview,
}: {
  data: TrackerScreenData;
  lang: Lang;
  shortCode: string;
  realtimeUrl: string | null;
  preview?: TrackerPreview;
}) {
  const c = g6Copy[lang];
  const router = useRouter();
  const { data, clock, online, failed, refresh } = useTrackerSync(initial, shortCode, realtimeUrl, !!preview, preview?.offline);
  const { session } = data;
  const tablePath = `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; reviewCart?: boolean } | null>(() => preview?.notice ?? null);
  const [confirm, setConfirm] = useState<Line | "bill" | null>(() =>
    preview?.confirm === "bill"
      ? "bill"
      : preview?.confirm === "cancel"
      ? initial.rounds.flatMap((r) => r.lines).find((l) => l.canCancel) ?? null
      : null
  );
  const attempts = useRef<Partial<Record<ServiceKind, string>>>({});
  const billRequested = session.status === "bill_requested";
  const canOrder = !billRequested && !session.orderingLocked;
  const goMenu = () => { if (!preview) router.push(`${tablePath}/menu`); };
  const [tab, setTab] = useState<"orders" | "items">(() => preview?.tab ?? "orders");
  const items = itemList(data.rounds);
  const nameOf = (line: Line) => (lang === "hi" && line.nameHi ? line.nameHi : line.nameEn);

  function requestId(kind: ServiceKind) {
    const key = `tq_service:${session.key}:${kind}`;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) return saved;
      const id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
      return id;
    } catch {
      return (attempts.current[kind] ??= crypto.randomUUID());
    }
  }

  async function sendService(kind: ServiceKind) {
    if (preview) { setConfirm(null); return; }
    if (busyRef.current || !online) return;
    busyRef.current = true;
    setBusy(kind);
    setNotice(null);
    try {
      const result = await serviceRequestAction(data.outlet.code, shortCode, kind, requestId(kind));
      if (!result.ok) {
        if (result.error === "gone") { router.replace(tablePath); return; }
        setNotice({
          text: result.error === "host_only" ? c.hostOnly(session.hostName) : result.error === "blocked" ? c.billBody : c.failed,
          error: true,
        });
      } else {
        try { sessionStorage.removeItem(`tq_service:${session.key}:${kind}`); } catch { /* Private storage unavailable. */ }
        delete attempts.current[kind];
        setNotice({ text: `${c.service[kind]} · ${c.waiterNotifiedDetail}` });
      }
      await refresh();
    } catch {
      setNotice({ text: c.failed, error: true });
    } finally {
      busyRef.current = false;
      setBusy(null);
      setConfirm(null);
    }
  }

  async function cancel(line: Line) {
    if (preview) { setConfirm(null); return; }
    if (busyRef.current || !online) return;
    busyRef.current = true;
    setBusy(line.id);
    setNotice(null);
    try {
      const result = await cancelLineAction(data.outlet.code, shortCode, line.id);
      if (!result.ok && result.error === "gone") { router.replace(tablePath); return; }
      setNotice(
        result.ok
          ? { text: c.cancelled }
          : { text: result.error === "accepted" ? c.cancelBlocked : c.cancelFailed, error: true }
      );
      await refresh();
    } catch {
      setNotice({ text: c.cancelFailed, error: true });
    } finally {
      busyRef.current = false;
      setBusy(null);
      setConfirm(null);
    }
  }

  async function repeatRound(orderId: string) {
    if (preview || busyRef.current || !online || !canOrder) return;
    busyRef.current = true;
    setBusy(`repeat:${orderId}`);
    setNotice(null);
    try {
      const result = await repeatOrderRoundAction(data.outlet.code, shortCode, orderId);
      if (!result.ok) {
        if (result.error === "gone") { router.replace(tablePath); return; }
        setNotice({ text: result.error === "blocked" ? c.billBody : c.repeatNone, error: true });
      } else if (result.added > 0) {
        setNotice({ text: c.repeatDone(result.added, result.skipped), reviewCart: true });
      } else {
        setNotice({ text: c.repeatNone, error: true });
      }
    } catch {
      setNotice({ text: c.repeatNone, error: true });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const allServed = data.rounds.length > 0 && data.inProgress === 0 && data.rounds.every((r) => r.status === "served");
  const announcement = data.rounds
    .map((r) => `${c.round(r.roundNo)}: ${r.lines.map((l) => `${nameOf(l)} ${c.meaning[l.status]}`).join(", ")}`)
    .join(". ");

  return (
    <div
      lang={lang}
      style={brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties}
      className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}
    >
      {/* Restaurant Header */}
      <header className="flex items-center gap-2.5 pt-5">
        <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-section leading-tight font-bold break-words text-ink">{data.outlet.name}</p>
          <Link
            href={preview ? "#" : `${tablePath}/table`}
            prefetch={false}
            className="relative text-caption whitespace-nowrap text-muted underline-offset-2 before:absolute before:-inset-y-3.5 before:inset-x-0 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {c.tableLine(isRoomCode(data.table.code) ? (lang === "hi" ? placeHi(data.table.code) : data.table.code) : `${lang === "hi" ? "टेबल" : "Table"} ${data.table.code.replace(/^T(?=\d)/, "")}`, session.people)} <span aria-hidden>›</span>
          </Link>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
        <Link
          href={preview ? "#" : `${tablePath}/cart`}
          prefetch={false}
          aria-label={c.openCart(data.cartCount)}
          className="relative grid size-11 shrink-0 place-items-center rounded-full border border-line/70 bg-surface text-ink shadow-[0_2px_8px_rgb(31_41_55/0.06)] hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <HugeiconsIcon icon={ShoppingBasket01Icon} size={21} aria-hidden />
          {data.cartCount > 0 && (
            <span aria-hidden className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-label font-bold tabular text-brand-on ring-2 ring-paper">
              {data.cartCount > 99 ? "99+" : data.cartCount}
            </span>
          )}
        </Link>
      </header>
      <RoomDashboardLink outletCode={data.outlet.code} shortCode={shortCode} tableCode={data.table.code} lang={lang} preview={!!preview} />

      <main className="pb-8">
        {/* Title */}
        <div className="mt-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[1.625rem] leading-tight font-bold tracking-tight text-ink">{c.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-muted">
              {data.rounds.length > 0 && data.inProgress > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-caption font-semibold text-success">
                  <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
                  {c.live}
                </span>
              )}
              {c.liveSub}
            </p>
          </div>
          {canOrder && data.rounds.length > 0 && (
            <button
              type="button"
              onClick={goMenu}
              className="mt-1 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-line/70 bg-surface px-3 text-caption font-semibold text-ink shadow-[0_1px_3px_rgb(31_41_55/0.05)] transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
            >
              {c.addMore}
            </button>
          )}
        </div>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        {/* Status Banners */}
        {!online && <Notice title={c.offline} body={c.offlineBody} kind="offline" />}
        {billRequested ? (
          <Notice title={c.billTitle} body={c.billBody} kind="bill" />
        ) : session.orderingLocked ? (
          <Notice title={c.paused} body={c.pausedBody} kind="paused" />
        ) : null}

        {allServed && !billRequested && !session.orderingLocked && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-success/20 bg-[var(--state-available-soft)] p-4 text-ink">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={22} className="mt-0.5 shrink-0 text-success" aria-hidden />
            <div>
              <p className="text-body font-semibold text-success">{c.allServedTitle}</p>
              <p className="mt-0.5 text-caption text-muted">{c.allServedBody}</p>
            </div>
          </div>
        )}

        {(failed || preview?.failed) && (
          <div role="alert" className="mt-4 rounded-2xl border border-line bg-surface p-4 text-body">
            <p>{c.refreshFailed}</p>
            <button
              type="button"
              onClick={() => { void refresh(); }}
              disabled={!online}
              className="mt-2 inline-flex min-h-11 items-center text-body font-semibold text-brand underline underline-offset-4"
            >
              {c.retry}
            </button>
          </div>
        )}

        {notice && (
          <div
            role={notice.error ? "alert" : "status"}
            className={`mt-4 flex items-start justify-between gap-3 rounded-2xl p-4 text-body shadow-sm ${
              notice.error
                ? "border border-danger/20 bg-[var(--state-seated-soft)] text-danger"
                : "border border-success/20 bg-[var(--state-available-soft)] text-success"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <HugeiconsIcon
                icon={notice.error ? AlertCircleIcon : CheckmarkCircle02Icon}
                size={20}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              <p className="text-body font-semibold">{notice.text}</p>
            </div>
            {notice.reviewCart && (
              <button type="button" onClick={() => router.push(`${tablePath}/cart`)} className="shrink-0 min-h-11 rounded-lg bg-brand px-3 text-caption font-semibold text-brand-on">
                {c.reviewCart}
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label={c.close}
              className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-full hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
            </button>
          </div>
        )}

        {/* Two views of the same orders: by round as sent, or every dish added up */}
        {data.rounds.length > 0 && (
          <div role="tablist" aria-label={c.activeOrders} className="mt-5 grid grid-cols-2 gap-2">
            {(["orders", "items"] as const).map((t) => {
              const on = tab === t;
              const count = t === "orders" ? data.rounds.length : items.lines.reduce((n, l) => n + l.qty, 0);
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t)}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border text-body font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    on ? "border-brand bg-brand text-brand-on shadow-[0_4px_12px_-2px_var(--brand-border)]" : "border-line/70 bg-surface text-ink shadow-[0_1px_3px_rgb(31_41_55/0.05)] hover:border-ink/30"
                  }`}
                >
                  <HugeiconsIcon icon={t === "orders" ? Note01Icon : LeftToRightListBulletIcon} size={18} aria-hidden />
                  {t === "orders" ? c.ordersTab : c.itemsTab}
                  <span className={`min-w-6 rounded-full px-1.5 text-label tabular ${on ? "bg-white/25 text-brand-on" : "bg-ink/10 text-ink"}`}>{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Rounds List / Item List / Empty State */}
        {data.rounds.length && tab === "items" ? (
          <ItemList items={items} c={c} lang={lang} />
        ) : data.rounds.length ? (
          <div className="mt-5 space-y-4">
            {data.rounds.map((round) => (
              <RoundView
                key={round.orderId}
                round={round}
                c={c}
                lang={lang}
                timezone={data.timezone}
                late={online ? round.lateAt !== null && clock >= round.lateAt : round.isLate}
                disabled={!online || !!busy}
                onCancel={setConfirm}
                onRepeat={() => void repeatRound(round.orderId)}
                repeating={busy === `repeat:${round.orderId}`}
                canOrder={canOrder}
              />
            ))}
            {items.lines.length > 0 && (
              <div className="flex items-center gap-3 rounded-[20px] border border-brand-border/60 bg-brand-soft/60 p-3.5">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-brand">
                  <HugeiconsIcon icon={Invoice01Icon} size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-bold text-ink">{c.totalSoFar}</p>
                  <p className="text-caption text-muted tabular">{c.totalLine(items.lines.reduce((n, l) => n + l.qty, 0), formatRupees(items.totalPaise))}</p>
                </div>
                <Link
                  href={preview ? "#" : `${tablePath}/bill`}
                  prefetch={false}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-brand bg-surface px-3.5 text-caption font-bold text-brand-strong hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {c.viewBill}
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden />
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="py-14 text-center">
            <div className="mx-auto grid size-20 place-items-center rounded-full bg-surface text-ink ring-1 ring-line shadow-sm">
              <HugeiconsIcon icon={Invoice01Icon} size={32} className="text-muted" aria-hidden />
            </div>
            <h2 className="mt-4 font-display text-section font-bold">{c.empty}</h2>
            <p className="mx-auto mt-2 max-w-[280px] text-body text-muted">{c.emptyBody}</p>
            {canOrder && (
              <button
                type="button"
                onClick={goMenu}
                className={`${button} mx-auto mt-6 flex w-full max-w-[280px] items-center justify-center gap-2 bg-brand text-brand-on hover:bg-brand-hover`}
              >
                <span>{c.browse}</span>
                <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden />
              </button>
            )}
          </div>
        )}

        {/* Service Requests Section */}
        <section aria-labelledby="service-heading" className="mt-8">
          <div className="flex items-start gap-3">
            <HugeiconsIcon icon={Notification01Icon} size={22} className="mt-0.5 text-brand" aria-hidden />
            <div>
              <h2 id="service-heading" className="font-display text-section font-bold text-ink">
                {c.needs}
              </h2>
              <p className="text-caption text-muted">{c.serviceHelp}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5 min-[400px]:grid-cols-4 min-[400px]:gap-2">
            {data.requests.map((request) => {
              const isBill = request.kind === "request_bill";
              const cooling = Math.max(0, Math.ceil((request.cooldownUntil - clock) / 1000));
              const pending = request.status === "open";
              const isDone = request.status === "done";
              const disabled = !online || !!busy || cooling > 0 || pending || (isBill && (!session.isHost || billRequested));
              const minutes = request.requestedAt === null ? 0 : Math.max(0, Math.floor((clock - request.requestedAt) / 60_000));
              const sent = minutes ? c.sentAgo(minutes) : c.sent;
              const IconComponent = serviceIcons[request.kind];

              return (
                <div key={request.kind} className={isBill ? "col-span-2 mt-1 min-[400px]:col-span-4" : ""}>
                  <button
                    type="button"
                    onClick={() => (isBill ? setConfirm("bill") : void sendService(request.kind))}
                    disabled={disabled}
                    aria-busy={busy === request.kind || undefined}
                    className={`group flex w-full flex-col items-center justify-center gap-2 rounded-[20px] border p-3 text-center transition-all focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed ${
                      isBill
                        ? session.isHost && !billRequested
                          ? "min-h-[82px] border-brand/30 bg-surface text-ink hover:border-brand shadow-sm"
                          : "min-h-[76px] border-line bg-[#F5F2EC] text-muted opacity-85"
                        : pending || cooling > 0
                        ? "min-h-[92px] border-line bg-[#F5F2EC] text-muted"
                        : "min-h-[100px] border-line/60 bg-surface text-ink shadow-[0_2px_12px_rgb(31_41_55/0.05)] hover:border-brand"
                    }`}
                  >
                    <div className={`relative grid size-10 place-items-center rounded-full ${pending || cooling > 0 ? "bg-ink/5" : "bg-brand-soft"}`}>
                      {busy === request.kind ? (
                        <HugeiconsIcon icon={Loading03Icon} size={22} className="animate-spin text-brand" aria-hidden />
                      ) : (
                        <HugeiconsIcon
                          icon={IconComponent}
                          size={22}
                          className={
                            pending || cooling > 0
                              ? "text-muted"
                              : isBill && session.isHost && !billRequested
                              ? "text-brand"
                              : "text-brand"
                          }
                          aria-hidden
                        />
                      )}
                    </div>
                    <span className="text-caption leading-tight font-semibold min-[400px]:text-label">
                      {isBill && billRequested ? c.billTitle : c.service[request.kind]}
                    </span>

                    {/* Cooldown or Pending status */}
                    {pending && (
                      <span className="inline-flex items-center gap-1 text-label font-medium text-muted">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} className="text-success" aria-hidden />
                        {c.waiterNotified}
                      </span>
                    )}
                    {cooling > 0 && !pending && (
                      <span className="inline-flex items-center gap-1 text-label font-medium text-muted">
                        <HugeiconsIcon icon={Clock01Icon} size={13} aria-hidden />
                        {c.cooldown(cooling)}
                      </span>
                    )}
                    {!pending && cooling === 0 && isDone && request.requestedAt !== null && (
                      <span className="text-label text-muted">{c.done}</span>
                    )}
                  </button>

                  {isBill && !session.isHost && !billRequested && (
                    <p className="mt-2 text-center text-caption text-muted">{c.hostOnly(session.hostName)}</p>
                  )}
                  {!isBill && request.requestedAt !== null && !pending && cooling === 0 && !isDone && (
                    <p className="mt-1 text-center text-caption text-muted">{sent}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <DiningNav tablePath={tablePath} active="orders" lang={lang} inProgress={data.inProgress} preview={!!preview} />

      {confirm && (
        <ConfirmDialog
          title={confirm === "bill" ? c.billConfirm : c.cancelTitle()}
          body={
            confirm === "bill"
              ? c.billConfirmBody
              : `${c.cancelItemDetail(nameOf(confirm), confirm.qty)} ${c.cancelBody}`
          }
          confirmText={confirm === "bill" ? c.service.request_bill : c.cancel}
          keepText={confirm === "bill" ? c.keepOrdering : c.keep}
          busy={!!busy}
          disabled={!online}
          isBill={confirm === "bill"}
          onClose={() => { if (!busy) setConfirm(null); }}
          onConfirm={() => (confirm === "bill" ? void sendService("request_bill") : void cancel(confirm))}
        />
      )}
    </div>
  );
}

function RoundView({
  round,
  c,
  lang,
  timezone,
  late,
  disabled,
  onCancel,
  onRepeat,
  repeating,
  canOrder,
}: {
  round: Round;
  c: G6Copy;
  lang: Lang;
  timezone: string;
  late: boolean;
  disabled: boolean;
  onCancel: (line: Line) => void;
  onRepeat: () => void;
  repeating: boolean;
  canOrder: boolean;
}) {
  const isAllServed = round.status === "served";
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(round.placedAt));

  const placedByLabel = round.placedBy
    ? round.placedBy === "You" || round.placedBy === "आप"
      ? c.byYou
      : c.by(round.placedBy)
    : c.anotherGuest;

  return (
    <section aria-label={c.round(round.roundNo)} className="rounded-[20px] border border-line/60 bg-surface p-4 shadow-[0_2px_12px_rgb(31_41_55/0.05)] min-[360px]:p-5">
      {/* Round Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-section font-bold text-ink">{c.round(round.roundNo)}</h2>
          <p className="mt-0.5 text-caption text-muted tabular">{c.placedAt(time, round.lines.reduce((n, l) => n + (l.status === "cancelled" || l.status === "voided" ? 0 : l.qty), 0))}</p>
          <p className="text-caption text-muted">{placedByLabel}</p>
        </div>
        {isAllServed ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-caption font-semibold text-success">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} aria-hidden />
            {c.allServedBadge}
          </span>
        ) : round.status !== "cancelled" ? (
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold ${tone[round.status]}`}>
            <StatusIcon status={round.status} />
            {c.status[round.status]}
          </span>
        ) : null}
      </div>

      {/* Progress Strip Stepper */}
      {round.status !== "cancelled" ? (
        <div className="mt-4 px-1" aria-label={`${c.progress}: ${c.meaning[round.status]}`}>
          <div className="relative flex items-start justify-between" aria-hidden>
            <div className="absolute top-[18px] right-[34px] left-[34px] h-0.5 -translate-y-1/2 bg-line/80" />
            <div
              className="absolute top-[18px] left-[34px] h-0.5 -translate-y-1/2 bg-success transition-all duration-300"
              style={{ width: `calc((100% - 68px) * ${isAllServed ? 1 : Math.max(0, round.step) / 3})` }}
            />
            {steps.map((step, i) => {
              const isComplete = isAllServed || i < round.step;
              const isCurrent = !isAllServed && i === round.step;
              return (
                <div key={step} className="relative z-10 flex w-[68px] flex-col items-center">
                  <div
                    className={`grid size-9 place-items-center rounded-full transition-all duration-200 ${
                      isComplete
                        ? "bg-success text-white"
                        : isCurrent
                        ? "bg-success text-white ring-4 ring-success/20"
                        : "border border-line bg-paper text-muted"
                    }`}
                  >
                    <HugeiconsIcon icon={isComplete ? Tick02Icon : STEP_ICONS[step]} size={isComplete ? 18 : 17} strokeWidth={isComplete ? 2.6 : 1.8} />
                  </div>
                  <p
                    className={`mt-2 max-w-[68px] text-center text-label break-words transition-colors min-[360px]:max-w-[76px] ${
                      isCurrent ? "font-bold text-ink" : isComplete ? "font-medium text-ink" : "text-muted"
                    }`}
                  >
                    {c.stepper[step]}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-caption font-semibold text-danger">
          <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
          {c.meaning.cancelled}
        </p>
      )}

      {/* Item Rows */}
      <ul className="mt-4 divide-y divide-line/70">
        {round.lines.map((line) => {
          const name = lang === "hi" && line.nameHi ? line.nameHi : line.nameEn;
          const removed = line.status === "cancelled" || line.status === "voided";

          return (
            <li key={line.id} className="py-3.5 first:pt-2 last:pb-0">
              <div className="flex items-start gap-3">
                <LineThumb photo={line.imageUrl} faded={removed} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-body font-bold break-words ${removed ? "text-muted line-through" : "text-ink"}`}>{name}</p>
                      {line.isVeg !== null && (
                        <p className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
                          <span
                            role="img"
                            aria-label={line.isVeg ? c.vegLabel : c.nonVegLabel}
                            className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px] ${line.isVeg ? "border-success" : "border-danger"}`}
                          >
                            <span className={`size-1.5 rounded-full ${line.isVeg ? "bg-success" : "bg-danger"}`} />
                          </span>
                          <span aria-hidden>{line.isVeg ? c.veg : c.nonVeg}</span>
                          {line.spice !== null && line.spice > 0 && <><span aria-hidden>·</span>{c.spice[line.spice]}</>}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-right tabular">
                      <span className={`block text-body font-bold ${removed ? "text-muted" : "text-ink"}`}>{formatRupees(line.amountPaise)}</span>
                      <span className="block text-caption text-muted">× {line.qty}</span>
                    </p>
                  </div>

                  {line.options.length > 0 && (
                    <p className="mt-0.5 text-caption text-muted">
                      {line.options.map((o) => (lang === "hi" && o.nameHi ? o.nameHi : o.nameEn)).join(" · ")}
                    </p>
                  )}
                  {line.note && (
                    <p className="mt-0.5 text-caption break-words text-muted italic">“{line.note}”</p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold ${tone[line.status]}`}>
                      <StatusIcon status={line.status} />
                      <span>{c.meaning[line.status]}</span>
                    </span>
                    {line.canCancel && (
                      <button
                        type="button"
                        onClick={() => onCancel(line)}
                        disabled={disabled}
                        aria-label={`${c.cancel}: ${name} × ${line.qty}`}
                        className="inline-flex min-h-11 min-w-[72px] items-center justify-center rounded-xl border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-ink shadow-sm transition-colors hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {c.cancel}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Late item warning banner */}
              {late && !removed && line.status !== "served" && (
                <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-[var(--state-held)]/30 bg-[var(--state-held-soft)] px-3 py-2 text-caption text-warning">
                  <HugeiconsIcon icon={AlertCircleIcon} size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <div>
                    <span className="font-semibold">{c.lateTitle}</span>
                    <span className="mx-1 text-warning/70">·</span>
                    <span>{c.lateBody}</span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {round.canRepeat && (
        <button
          type="button"
          onClick={onRepeat}
          disabled={disabled || !canOrder || repeating}
          className="mt-4 min-h-11 w-full rounded-xl border border-brand/30 bg-brand/5 px-4 text-button font-semibold text-brand-strong transition-colors hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {repeating ? c.repeatWorking : c.repeatOrder}
        </button>
      )}
    </section>
  );
}

/** The dish's small menu photo, or a plate icon when it has none */
function LineThumb({ photo, faded }: { photo: string | null; faded: boolean }) {
  const [failed, setFailed] = useState(0);
  const src = failed === 0 ? menuThumb(photo) : failed === 1 ? photo : null;
  return src ? (
    // Restaurant photos can live on any host, so this stays a plain lazy image
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed((n) => n + 1)} className={`size-16 shrink-0 rounded-xl bg-line/40 object-cover ${faded ? "opacity-50 grayscale" : ""}`} />
  ) : (
    <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-soft to-paper text-brand/60">
      <HugeiconsIcon icon={Restaurant01Icon} size={24} strokeWidth={1.5} />
    </span>
  );
}

/** Every dish across all rounds, added up by name and options; cancelled and voided ones left out */
function itemList(rounds: Round[]) {
  const map = new Map<string, { key: string; nameEn: string; nameHi: string | null; options: Line["options"]; qty: number; amountPaise: number }>();
  for (const r of [...rounds].reverse()) {
    for (const l of r.lines) {
      if (l.status === "cancelled" || l.status === "voided") continue;
      const key = [l.nameEn, ...l.options.map((o) => o.nameEn)].join("|");
      const row = map.get(key) ?? { key, nameEn: l.nameEn, nameHi: l.nameHi, options: l.options, qty: 0, amountPaise: 0 };
      row.qty += l.qty;
      row.amountPaise += l.amountPaise;
      map.set(key, row);
    }
  }
  const lines = [...map.values()];
  return { lines, totalPaise: lines.reduce((n, l) => n + l.amountPaise, 0) };
}

function ItemList({ items, c, lang }: { items: ReturnType<typeof itemList>; c: G6Copy; lang: Lang }) {
  if (!items.lines.length) return <p className="py-10 text-center text-body text-muted">{c.itemsEmpty}</p>;
  const pick = (en: string, hi: string | null | undefined) => (lang === "hi" && hi ? hi : en);
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface px-4 shadow-sm">
      <ul className="divide-y divide-line/70">
        {items.lines.map((l) => (
          <li key={l.key} className="flex items-start gap-3 py-3">
            <span className="min-w-8 rounded-md bg-ink/5 px-1.5 py-0.5 text-center text-caption font-bold tabular text-ink">{l.qty}×</span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold break-words text-ink">{pick(l.nameEn, l.nameHi)}</span>
              {l.options.length > 0 && <span className="block text-caption text-muted">{l.options.map((o) => pick(o.nameEn, o.nameHi)).join(", ")}</span>}
            </span>
            <span className="shrink-0 text-body font-semibold tabular text-ink">{formatRupees(l.amountPaise)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-line py-3">
        <span className="text-body font-bold text-ink">{c.itemsTotal}</span>
        <span className="font-display text-section font-bold tabular text-ink">{formatRupees(items.totalPaise)}</span>
      </div>
      <p className="pb-3 text-caption text-muted">{c.itemsTaxNote}</p>
    </section>
  );
}

function StatusIcon({ status }: { status: LineStatus }) {
  switch (status) {
    case "placed":
      return <HugeiconsIcon icon={Clock01Icon} size={14} className="shrink-0" aria-hidden />;
    case "accepted":
      return <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} className="shrink-0" aria-hidden />;
    case "preparing":
      return <HugeiconsIcon icon={Clock01Icon} size={14} className="shrink-0" aria-hidden />;
    case "ready":
      return <HugeiconsIcon icon={AlertCircleIcon} size={14} className="shrink-0" aria-hidden />;
    case "served":
      return <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} className="shrink-0" aria-hidden />;
    case "cancelled":
    case "voided":
      return <HugeiconsIcon icon={Cancel01Icon} size={14} className="shrink-0" aria-hidden />;
  }
}

function Notice({ title, body, kind }: { title: string; body: string; kind: "offline" | "bill" | "paused" }) {
  return (
    <div
      role="status"
      className={`mt-4 flex items-start gap-3 rounded-2xl p-4 ${
        kind === "bill"
          ? "border border-[#F5DAC1] bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]"
          : kind === "paused"
          ? "border border-[var(--state-held)]/20 bg-[var(--state-held-soft)] text-warning"
          : "border border-danger/20 bg-[var(--state-seated-soft)] text-danger"
      }`}
    >
      <HugeiconsIcon
        icon={kind === "offline" ? WifiOff01Icon : kind === "bill" ? InformationCircleIcon : Clock01Icon}
        size={20}
        className="shrink-0 mt-0.5"
        aria-hidden
      />
      <div>
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-0.5 text-caption opacity-90">{body}</p>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmText,
  keepText,
  busy,
  disabled,
  isBill,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmText: string;
  keepText: string;
  busy: boolean;
  disabled: boolean;
  isBill?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      try { dialog.showModal(); } catch {}
    }
    return () => {
      try { dialog?.close(); } catch {}
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="g6-confirm-title"
      aria-describedby="g6-confirm-body"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-[480px] mx-auto rounded-t-[28px] border-t border-line bg-paper p-6 text-ink shadow-[var(--shadow-modal)] backdrop:bg-ink/40 [transform:translateZ(0)]"
    >
      {/* Bottom Sheet Drag Indicator */}
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" aria-hidden />

      <h2 id="g6-confirm-title" className="font-display text-title font-bold text-ink">
        {title}
      </h2>
      <p id="g6-confirm-body" className="mt-2.5 text-body text-muted leading-relaxed">
        {body}
      </p>

      <div className="mt-6 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || disabled}
          className={`${button} w-full ${isBill ? "bg-brand text-brand-on" : "bg-danger text-white"} disabled:opacity-60`}
        >
          {busy ? "…" : confirmText}
        </button>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          disabled={busy}
          className={`${button} w-full border border-line bg-surface text-ink hover:bg-ink/5`}
        >
          {keepText}
        </button>
      </div>
    </dialog>
  );
}
