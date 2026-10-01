"use client";

import {
  Alert02Icon,
  ArrowLeft01Icon,
  Delete02Icon,
  InformationCircleIcon,
  Invoice01Icon,
  Loading03Icon,
  MinusSignIcon,
  PauseIcon,
  PlusSignIcon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { checkFirstName, MAX_NAME_LENGTH } from "@/domain/guest-name";
import { formatRupees } from "@/domain/menu-price";
import { MAX_QTY } from "@/domain/pricing";
import type { Lang } from "@/lib/i18n";
import type { RemovedLine } from "@/server/guest/cart";
import type { CartLineView, CartScreenData, OtherLineView } from "@/server/guest/cart-screen";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { SlowNotice } from "../../_components/slow-notice";
import { pick, VegMark } from "../../menu/_components/menu-row";
import { menuRealtimeTokenAction } from "../../menu/actions";
import { TextField } from "../../verify/_components/text-field";
import { g3Copy } from "../../menu/_copy";
import { g5Copy, type G5Copy } from "../_copy";
import { placeOrderAction, restoreLineAction } from "../actions";
import { useCartSync, useOnline } from "../_hooks/use-cart-sync";

/** A frozen state for the dev review board */
export type CartPreview = {
  tab?: "mine" | "table";
  name?: string;
  offline?: boolean;
  placing?: boolean;
  notice?: "failed" | "cap" | "items";
  /** Show the Undo toast for this line, already removed */
  undoLine?: string;
};

const UNDO_MS = 5000;

export function CartScreen({
  data,
  lang,
  shortCode,
  fromMenu,
  realtimeUrl,
  preview,
}: {
  data: CartScreenData;
  lang: Lang;
  shortCode: string;
  /** Opened from the menu's cart bar, so Back can simply go back */
  fromMenu: boolean;
  realtimeUrl: string | null;
  preview?: CartPreview;
}) {
  const c = g5Copy[lang];
  const router = useRouter();
  const { session, table } = data;
  const tablePath = `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const menuPath = `${tablePath}/menu`;

  const [tab, setTab] = useState<"mine" | "table">(preview?.tab ?? "mine");
  const [name, setName] = useState(preview?.name ?? "");
  const [nameTouched, setNameTouched] = useState(!!preview?.name);
  const [placing, setPlacing] = useState(!!preview?.placing);
  const [notice, setNotice] = useState<"failed" | "cap" | "items" | null>(preview?.notice ?? null);
  const [toast, setToast] = useState<{ text: string; snapshot?: RemovedLine | null; lineId?: string } | null>(() => {
    const line = preview?.undoLine ? data.mine.find((l) => l.id === preview.undoLine) : undefined;
    return line ? { text: c.removed(pick(lang, line.nameEn, line.nameHi)), lineId: line.id } : null;
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fallbackRequestId = useRef<string | null>(null);

  const showToast = (t: { text: string; snapshot?: RemovedLine | null; lineId?: string }) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  };

  const { qtyOf, setQty, remove, isRemoved, refresh } = useCartSync({
    outletCode: data.outlet.code,
    shortCode,
    renderedAt: data.renderedAt,
    realtimeUrl,
    getToken: () => menuRealtimeTokenAction(data.outlet.code, shortCode),
    onError: (e) => {
      if (e === "gone") router.replace(tablePath);
      else if (e === "failed") showToast({ text: c.updateFailed });
    },
    preview: !!preview,
    initialRemoved: preview?.undoLine ? [preview.undoLine] : undefined,
  });

  const online = useOnline(preview?.offline);
  const paused = session.orderingLocked;
  const billRequested = session.status === "bill_requested";
  const locked = paused || billRequested || !online || placing;

  const lines = data.mine.filter((l) => !isRemoved(l.id)).map((l) => ({ ...l, qty: qtyOf(l.id, l.qty) }));
  const subtotal = lines.reduce((sum, l) => sum + (l.reason || l.unitPricePaise === null ? 0 : l.unitPricePaise * l.qty), 0);
  const blocked = lines.some((l) => l.reason);
  const nameCheck = checkFirstName(name);
  const nameError = session.needsName && nameTouched && !nameCheck.ok && name.trim() ? c.nameError : undefined;

  const back = () => {
    if (preview) return;
    if (fromMenu) router.back();
    else router.replace(menuPath);
  };

  // Clear the Undo timer when leaving
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  async function onRemove(line: CartLineView) {
    const label = pick(lang, line.nameEn, line.nameHi);
    const res = await remove(line.id);
    if (res.ok) showToast({ text: c.removed(label), snapshot: res.snapshot });
  }

  async function onUndo() {
    const snap = toast?.snapshot;
    setToast(null);
    if (!snap || preview) return;
    const line = data.mine.find((l) => l.itemId === snap.itemId);
    const label = line ? pick(lang, line.nameEn, line.nameHi) : "";
    const res = await restoreLineAction(data.outlet.code, shortCode, snap).catch(() => ({ ok: false as const, error: "failed" as const }));
    if (!res.ok) showToast({ text: res.error === "unavailable" ? c.restoreFailed(label) : c.updateFailed });
    refresh();
  }

  /** One id per Place-order attempt, kept across retries and reloads until it succeeds */
  function requestId(): string {
    const key = `tq_place_req:${session.key}`;
    try {
      let id = sessionStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(key, id);
      }
      return id;
    } catch {
      fallbackRequestId.current ??= crypto.randomUUID();
      return fallbackRequestId.current;
    }
  }

  async function onPlace() {
    if (preview || placing) return;
    if (session.needsName && !nameCheck.ok) {
      setNameTouched(true);
      document.getElementById("g5-name")?.focus();
      return;
    }
    setPlacing(true);
    setNotice(null);
    const id = requestId();
    let res: Awaited<ReturnType<typeof placeOrderAction>>;
    try {
      res = await placeOrderAction(data.outlet.code, shortCode, { requestId: id, name: session.needsName ? name : undefined });
    } catch {
      // The order may or may not have reached the kitchen; the same id makes a retry safe
      res = { ok: false, error: "failed" };
    }
    if (res.ok) {
      try {
        sessionStorage.removeItem(`tq_place_req:${session.key}`);
      } catch {
        // Private mode: the confirmed order can still open in the tracker.
      }
      fallbackRequestId.current = null;
      router.replace(`${tablePath}/orders`);
      return;
    }
    setPlacing(false);
    switch (res.error) {
      case "items":
        setNotice("items");
        refresh();
        break;
      case "cap":
        setNotice("cap");
        break;
      case "name_required":
      case "invalid_name":
        setNameTouched(true);
        break;
      case "gone":
        router.replace(tablePath);
        return;
      case "blocked":
      case "empty":
        refresh();
        break;
      default:
        setNotice("failed");
    }
  }

  // ---- the button ----
  let cta: { label: string; enabled: boolean };
  if (placing) cta = { label: c.placing, enabled: false };
  else if (paused) cta = { label: c.ctaPaused, enabled: false };
  else if (billRequested) cta = { label: c.ctaBill, enabled: false };
  else if (!online) cta = { label: c.ctaOffline, enabled: false };
  else if (blocked) cta = { label: c.removeUnavailable, enabled: false };
  else if (session.needsName && !nameCheck.ok) cta = { label: c.addName, enabled: true };
  else cta = { label: c.place(table.code), enabled: true };
  const ctaReady = cta.label === c.place(table.code) || placing;

  const style = brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties;
  const showTabs = session.people > 1;

  return (
    <div lang={lang} style={style} className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      <header className="flex items-center gap-2 pt-3">
        <button
          type="button"
          onClick={back}
          aria-label={c.back}
          className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={22} aria-hidden />
        </button>
        <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={40} />
        <div className="min-w-0 flex-1 pl-1">
          <p className="font-display text-section font-bold break-words text-ink">{data.outlet.name}</p>
          <p className="text-caption text-muted">{c.tableLine(table.code, session.people)}</p>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
      </header>

      <main className="flex flex-1 flex-col pt-5">
        <h1 className="font-display text-title font-bold text-ink">{c.title}</h1>

        {showTabs && (
          <div role="tablist" aria-label={c.tabs} className="mt-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-surface p-1">
            {(["mine", "table"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`panel-${t}`}
                onClick={() => setTab(t)}
                className={`min-h-10 rounded-full text-body font-semibold transition-colors duration-150 ease-natural focus-visible:outline-2 focus-visible:outline-brand ${
                  tab === t ? "bg-brand text-brand-on" : "text-ink/75 hover:text-ink"
                }`}
              >
                {t === "mine" ? c.mine : c.wholeTable}
              </button>
            ))}
          </div>
        )}

        {paused ? (
          <Banner icon={PauseIcon} tone="paused" title={c.pausedBy(session.hostName)} body={c.canStillReview} />
        ) : billRequested ? (
          <Banner icon={Invoice01Icon} tone="bill" title={c.billRequested} body={c.canStillReview} />
        ) : null}
        {!online && <Banner icon={WifiOff01Icon} tone="offline" title={c.offline} body={c.offlineBody} />}

        {tab === "mine" ? (
          <section id="panel-mine" role={showTabs ? "tabpanel" : undefined} aria-labelledby={showTabs ? "tab-mine" : undefined} className="flex flex-1 flex-col">
            {lines.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-14 text-center">
                <p className="font-display text-section font-bold text-ink">{c.emptyTitle}</p>
                <p className="mt-1 text-body text-muted">{c.emptyBody}</p>
                <button
                  type="button"
                  onClick={back}
                  className="mt-6 min-h-12 w-full max-w-[280px] rounded-cta bg-brand px-5 text-button font-semibold text-brand-on hover:bg-brand-hover"
                >
                  {c.back}
                </button>
              </div>
            ) : (
              <>
                <ul className="mt-2">
                  {lines.map((l) => (
                    <MineLine key={l.id} line={l} lang={lang} c={c} locked={locked} onQty={setQty} onRemove={() => onRemove(l)} />
                  ))}
                </ul>

                {/* In the page flow, never fixed: it can not cover the last line, and it grows with large text */}
                <div className="mt-2 border-t border-line pt-4 pb-[max(24px,env(safe-area-inset-bottom))]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-section font-bold text-ink">{c.subtotal}</span>
                    <span className="text-section font-bold tabular text-ink">{formatRupees(subtotal)}</span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-caption text-muted">
                    <HugeiconsIcon icon={InformationCircleIcon} size={14} aria-hidden />
                    {c.taxNote}
                  </p>

                  {session.needsName && (
                    <div className="mt-5">
                      <TextField
                        id="g5-name"
                        label={c.nameLabel}
                        help={c.nameHelp}
                        error={nameError}
                        value={name}
                        maxLength={MAX_NAME_LENGTH}
                        autoComplete="given-name"
                        autoCapitalize="words"
                        enterKeyHint="send"
                        disabled={locked}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={() => setNameTouched(true)}
                      />
                    </div>
                  )}

                  {notice && (
                    <div role="alert" className="mt-4 flex items-start gap-3 rounded-cta bg-[var(--state-seated-soft)] px-4 py-3 ring-1 ring-danger/10 ring-inset">
                      <HugeiconsIcon icon={Alert02Icon} size={20} className="shrink-0 text-danger" aria-hidden />
                      <div>
                        <p className="text-body font-semibold text-danger">
                          {notice === "cap" ? c.capTitle : notice === "items" ? c.itemsChanged : c.failed}
                        </p>
                        {notice === "cap" && <p className="mt-0.5 text-caption text-ink/75">{c.capBody}</p>}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onPlace}
                    disabled={!cta.enabled}
                    aria-busy={placing || undefined}
                    className={`mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-cta px-5 py-3 text-center text-button font-semibold transition-[transform,background-color] duration-100 ease-natural focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] disabled:active:scale-100 ${
                      ctaReady ? "bg-brand text-brand-on hover:bg-brand-hover" : "bg-[#EFEAE2] text-ink/70 ring-1 ring-line ring-inset"
                    }`}
                  >
                    {placing && <HugeiconsIcon icon={Loading03Icon} size={20} className="animate-spin" aria-hidden />}
                    {cta.label}
                  </button>
                  <p className="mt-3 text-center text-caption text-muted">
                    {c.goesStraight}
                    <br />
                    {c.addMoreAnyTime}
                  </p>
                  {placing && !preview && (
                    <div className="mt-1">
                      <SlowNotice text={c.slow} />
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        ) : (
          <section id="panel-table" role="tabpanel" aria-labelledby="tab-table" className="mt-2 pb-8">
            <PersonGroup label={c.you} count={lines.reduce((n, l) => n + l.qty, 0)} c={c}>
              {lines.map((l) => (
                <ReadOnlyLine key={l.id} line={l} lang={lang} c={c} />
              ))}
            </PersonGroup>
            {data.others.map((g) => (
              <PersonGroup key={g.id} label={g.name ?? c.anotherGuest} count={g.count} c={c}>
                {g.lines.map((l) => (
                  <ReadOnlyLine key={l.id} line={l} lang={lang} c={c} />
                ))}
              </PersonGroup>
            ))}
            <p className="mt-5 text-caption text-muted">{data.others.length ? c.othersNote : c.othersEmpty}</p>
          </section>
        )}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] px-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[360px]:px-5">
          <div role="status" className="pointer-events-auto flex animate-fade items-center justify-between gap-3 rounded-cta bg-ink px-4 py-2 text-white shadow-[var(--shadow-float)]">
            <span className="text-body">{toast.text}</span>
            {(toast.snapshot || toast.lineId) && (
              <button type="button" onClick={onUndo} className="-my-1 min-h-11 shrink-0 px-2 text-body font-bold text-[#FFB59E] focus-visible:outline-2 focus-visible:outline-white">
                {c.undo}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------

function details(line: { options: { nameEn: string; nameHi: string | null }[]; note: string | null; shared: boolean }, lang: Lang, c: G5Copy) {
  return (
    <>
      {line.options.length > 0 && <p className="mt-0.5 text-caption text-ink/75">{line.options.map((o) => pick(lang, o.nameEn, o.nameHi)).join(" · ")}</p>}
      {line.note && <p className="mt-0.5 text-caption text-muted italic">“{line.note}”</p>}
      {line.shared && <span className="mt-1 inline-block rounded-full bg-paper px-2 text-label font-semibold text-muted ring-1 ring-line">{c.shared}</span>}
    </>
  );
}

function MineLine({
  line,
  lang,
  c,
  locked,
  onQty,
  onRemove,
}: {
  line: CartLineView;
  lang: Lang;
  c: G5Copy;
  locked: boolean;
  onQty: (lineId: string, qty: number) => void;
  onRemove: () => void;
}) {
  const name = pick(lang, line.nameEn, line.nameHi);
  const unavailable = !!line.reason;
  const total = line.unitPricePaise !== null ? formatRupees(line.unitPricePaise * line.qty) : null;
  const atMax = line.qty >= MAX_QTY;
  const stepBtn =
    "relative grid size-9 place-items-center rounded-[10px] transition-transform duration-100 ease-natural before:absolute before:-inset-1 active:scale-90 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

  return (
    <li className="border-b border-line/70 py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="mt-1">
          <VegMark veg={line.isVeg} label={line.isVeg ? g3Copy[lang].veg : g3Copy[lang].nonVeg} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-bold text-ink">{name}</p>
          {details(line, lang, c)}
          {unavailable && (
            <p role="status" className="mt-1.5 flex items-center gap-1.5 text-caption font-semibold text-danger">
              <HugeiconsIcon icon={Alert02Icon} size={14} aria-hidden />
              {c.reason[line.reason!]}
            </p>
          )}
        </div>
        {total && <span className={`shrink-0 text-body font-semibold tabular ${unavailable ? "text-muted line-through" : "text-ink"}`}>{total}</span>}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 pl-[26px]">
        <button
          type="button"
          onClick={onRemove}
          disabled={locked}
          aria-label={c.removeLabel(name)}
          className={`-ml-2 min-h-11 min-w-11 px-2 text-[13px] leading-5 font-medium underline-offset-4 hover:underline disabled:text-muted disabled:no-underline ${unavailable ? "font-semibold text-danger" : "text-ink/75"}`}
        >
          {c.remove}
        </button>
        {!unavailable && (
          <div role="group" aria-label={c.qtyOf(line.qty, name)} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (line.qty <= 1 ? onRemove() : onQty(line.id, line.qty - 1))}
              disabled={locked}
              aria-label={line.qty <= 1 ? c.removeLabel(name) : c.decrease(name)}
              className={`${stepBtn} border border-line bg-surface text-ink disabled:text-line`}
            >
              <HugeiconsIcon icon={line.qty <= 1 ? Delete02Icon : MinusSignIcon} size={17} strokeWidth={2} aria-hidden />
            </button>
            <span aria-live="polite" className="min-w-7 text-center text-body font-bold tabular text-ink">
              {line.qty}
            </span>
            <button
              type="button"
              onClick={() => onQty(line.id, line.qty + 1)}
              disabled={locked || atMax}
              aria-label={atMax ? `${c.increase(name)}. ${c.maxReached}` : c.increase(name)}
              className={`${stepBtn} bg-brand text-brand-on disabled:bg-line disabled:text-muted`}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={17} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function ReadOnlyLine({ line, lang, c }: { line: OtherLineView | CartLineView; lang: Lang; c: G5Copy }) {
  const name = pick(lang, line.nameEn, line.nameHi);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-1">
        <VegMark veg={line.isVeg} label={line.isVeg ? g3Copy[lang].veg : g3Copy[lang].nonVeg} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-body ${line.reason ? "text-muted" : "text-ink"}`}>
          {name} <span className="tabular text-muted">× {line.qty}</span>
        </p>
        {details(line, lang, c)}
        {line.reason && <p className="mt-0.5 text-caption font-semibold text-danger">{c.reason[line.reason]}</p>}
      </div>
    </li>
  );
}

function PersonGroup({ label, count, c, children }: { label: string; count: number; c: G5Copy; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="mt-4 border-t border-line/70 pt-3 first:border-t-0">
      <h2 className="text-body font-bold text-ink">
        {label} <span className="font-medium text-muted">· {c.items(count)}</span>
      </h2>
      <ul className="mt-1">{children}</ul>
    </section>
  );
}

const BANNER_TONE = {
  paused: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  bill: "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]",
  offline: "bg-surface text-ink ring-1 ring-line ring-inset",
} as const;

function Banner({ icon, tone, title, body }: { icon: IconSvgElement; tone: keyof typeof BANNER_TONE; title: string; body: string }) {
  return (
    <div role="status" className={`mt-4 flex items-start gap-3 rounded-cta px-4 py-3 ${BANNER_TONE[tone]}`}>
      <HugeiconsIcon icon={icon} size={20} className="shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-0.5 text-caption text-ink/75">{body}</p>
      </div>
    </div>
  );
}
