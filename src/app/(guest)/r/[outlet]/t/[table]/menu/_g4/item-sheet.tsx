"use client";

import {
  Alert02Icon,
  Cancel01Icon,
  Clock01Icon,
  InformationCircleIcon,
  Invoice01Icon,
  Loading03Icon,
  MinusSignIcon,
  PauseIcon,
  PepperIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ALLERGEN_LABELS, type Allergen } from "@/domain/allergens";
import { firstIncomplete, groupRule, hasQuickNote, linePrice, NOTE_MAX, QUICK_NOTES, toggleQuickNote } from "@/domain/item-sheet";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { formatRupees } from "@/domain/menu-price";
import { MAX_QTY } from "@/domain/pricing";
import type { Lang } from "@/lib/i18n";
import type { ItemSheetData } from "@/server/guest/item-sheet";
import { SlowNotice } from "../../_components/slow-notice";
import { pick, VegMark } from "../_components/menu-row";
import { g3Copy } from "../_copy";
import { g4Copy, type G4Copy } from "./_copy";
import { addItemAction } from "./actions";

/** A frozen state for the dev review board */
export type SheetPreview = {
  selected?: string[];
  qty?: number;
  note?: string;
  ack?: boolean;
  avoid?: Allergen[];
  attempted?: boolean;
  busy?: boolean;
  error?: "failed";
  /** Simulates the dish selling out after the sheet opened */
  soldOutLater?: boolean;
};

type Group = ItemSheetData["groups"][number];

// The menu's "Avoid allergens" choice for this visit, read from the same place G3 keeps it
const filtersEvent = "tq-menu-filters";
function subscribeFilters(cb: () => void) {
  window.addEventListener(filtersEvent, cb);
  return () => window.removeEventListener(filtersEvent, cb);
}
function readAvoid(sessionKey: string): string | null {
  try {
    return sessionStorage.getItem(`tq_menu_filters:${sessionKey}`);
  } catch {
    return null;
  }
}

/**
 * G4: one dish, its options, quantity and note, and "Add to cart". Opened over the menu as an
 * intercepted route, so closing goes back to the menu exactly as the guest left it.
 */
export function ItemSheet({
  data,
  lang,
  shortCode,
  mode,
  preview,
}: {
  data: ItemSheetData;
  lang: Lang;
  shortCode: string;
  /** sheet: opened over the menu; page: opened from a link or reload */
  mode: "sheet" | "page";
  preview?: SheetPreview;
}) {
  const c = g4Copy[lang];
  const m3 = g3Copy[lang];
  const router = useRouter();
  const { item, groups, session } = data;
  const tablePath = `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const name = pick(lang, item.nameEn, item.nameHi);
  const description = pick(lang, item.descriptionEn ?? "", item.descriptionHi);

  // ---- the guest's draft: kept on the phone, never reset by a refresh ----
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preview?.selected ?? []));
  const [qty, setQty] = useState(preview?.qty ?? 1);
  const [note, setNote] = useState(preview?.note ?? "");
  const [personalForPickup, setPersonalForPickup] = useState(false);
  const [ack, setAck] = useState(preview?.ack ?? false);
  const [attempted, setAttempted] = useState(preview?.attempted ?? false);
  const [busy, setBusy] = useState(preview?.busy ?? false);
  const [error, setError] = useState<string | null>(preview?.error ? c.failed : null);
  const [goneOptions, setGoneOptions] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<"sold_out" | "unavailable_now" | null>(preview?.soldOutLater ? "sold_out" : null);
  // Sold out when opened → read-only. Selling out later keeps the draft on screen.
  const [openedAvailable] = useState(item.available || !!preview?.soldOutLater);
  const readOnly = !openedAvailable;

  // Options that became unavailable since the guest picked them are dropped, never swapped
  const liveGroups: Group[] = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        modifiers: g.modifiers.map((m) => (goneOptions.has(m.id) ? { ...m, isAvailable: false } : m)),
      })),
    [groups, goneOptions],
  );
  const effective = useMemo(() => {
    const ok = new Set<string>();
    for (const g of liveGroups) for (const m of g.modifiers) if (m.isAvailable && selected.has(m.id)) ok.add(m.id);
    return ok;
  }, [liveGroups, selected]);

  // ---- allergens against this visit's "Avoid allergens" filter ----
  const storedFilters = useSyncExternalStore(subscribeFilters, () => readAvoid(session.key), () => null);
  const previewAvoid = preview?.avoid;
  const avoid: Allergen[] = useMemo(() => {
    if (previewAvoid) return previewAvoid;
    try {
      return storedFilters ? ((JSON.parse(storedFilters) as { avoid?: Allergen[] }).avoid ?? []) : [];
    } catch {
      return [];
    }
  }, [storedFilters, previewAvoid]);
  const allergenNames = (list: Allergen[]) => list.map((a) => ALLERGEN_LABELS[a][lang]).join(", ");
  const unknown = item.allergens === null || item.allergens.includes("other");
  const clash = (item.allergens ?? []).filter((a) => avoid.includes(a));
  const filterOn = avoid.length > 0;
  const needsAck = clash.length > 0 || (unknown && filterOn);

  // ---- what blocks Add ----
  const paused = session.orderingLocked;
  const billRequested = session.status === "bill_requested";
  const soldOutNow = !item.available || notice === "sold_out";
  const outsideHours = item.outsideHours || notice === "unavailable_now";
  const missing = firstIncomplete(liveGroups, effective);
  const total = linePrice(item.pricePaise, liveGroups, effective, qty);

  const groupRefs = useRef(new Map<string, HTMLFieldSetElement>());
  const ackRef = useRef<HTMLInputElement>(null);

  const close = () => {
    if (preview) return;
    if (mode === "sheet") router.back();
    else router.replace(`${tablePath}/menu`);
  };

  async function add() {
    if (preview || busy) return;
    if (missing) {
      setAttempted(true);
      const el = groupRefs.current.get(missing.id);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus({ preventScroll: true });
      return;
    }
    if (needsAck && !ack) {
      ackRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof addItemAction>>;
    try {
      res = await addItemAction(data.outlet.code, shortCode, { itemId: item.id, qty, modifierIds: [...effective], note, personalForPickup });
    } catch {
      res = { ok: false, error: "failed" };
    }
    if (res.ok) {
      // The menu underneath refreshes its cart and stepper on this signal
      window.dispatchEvent(new Event("tq-cart-changed"));
      close();
      return;
    }
    setBusy(false);
    switch (res.error) {
      case "option_unavailable":
        setGoneOptions((g) => new Set([...g, ...res.modifierIds]));
        setAttempted(true);
        setError(c.optionGone);
        break;
      case "sold_out":
        setNotice("sold_out");
        break;
      case "unavailable_now":
        setNotice("unavailable_now");
        break;
      case "max_qty":
        setError(c.maxQty);
        break;
      case "gone":
        router.replace(tablePath);
        return;
      case "blocked":
        break;
      default:
        setError(c.failed);
    }
    router.refresh();
  }

  // ---- the button ----
  let cta: { label: string; enabled: boolean; dimmed: boolean };
  if (busy) cta = { label: c.adding, enabled: false, dimmed: false };
  else if (paused) cta = { label: c.ctaPaused, enabled: false, dimmed: true };
  else if (billRequested) cta = { label: c.ctaBill, enabled: false, dimmed: true };
  else if (soldOutNow) cta = { label: c.nowSoldOut, enabled: false, dimmed: true };
  else if (outsideHours) cta = { label: c.ctaUnavailable, enabled: false, dimmed: true };
  // Still tappable: a tap shows the guest what is missing
  else if (missing) cta = { label: c.chooseToAdd(pick(lang, missing.nameEn, missing.nameHi)), enabled: true, dimmed: true };
  else if (needsAck && !ack) cta = { label: c.ackToAdd, enabled: true, dimmed: true };
  else cta = { label: c.addToCart(formatRupees(total)), enabled: true, dimmed: false };

  const banner = paused ? (
    <Notice icon={PauseIcon} tone="paused" title={c.pausedBy(session.hostName)} body={c.canStillView} />
  ) : billRequested ? (
    <Notice icon={Invoice01Icon} tone="bill" title={c.billRequested} body={c.canStillView} />
  ) : !readOnly && soldOutNow ? (
    <Notice icon={Alert02Icon} tone="danger" title={c.nowSoldOut} />
  ) : outsideHours && !readOnly ? (
    <Notice icon={Clock01Icon} tone="danger" title={c.outsideHours} />
  ) : null;

  const body = (
    <>
      {item.imageUrl && <Photo src={item.imageUrl} soldOut={readOnly} />}

      <div className="mt-3 flex items-center gap-1.5">
        <VegMark veg={item.isVeg} label={item.isVeg ? m3.veg : m3.nonVeg} />
        {item.isJain && <span className="rounded-[4px] border border-line px-1 text-[10px] leading-3.5 font-semibold text-muted">{m3.jainMark}</span>}
        {item.tag && <span className="rounded-full bg-[var(--state-held-soft)] px-1.5 text-label font-semibold text-[var(--state-held-text)]">{m3.tag[item.tag]}</span>}
      </div>
      <h2 id="g4-title" className="mt-1.5 font-display text-title font-bold text-ink">
        {name}
      </h2>
      <p className={`mt-1 text-section font-semibold tabular ${readOnly ? "text-muted" : "text-ink"}`}>{formatRupees(item.pricePaise)}</p>
      {description && <p className="mt-2 text-body text-muted">{description}</p>}

      <ul className="mt-3 space-y-1.5 text-caption text-ink/80">
        {item.spice !== null && item.spice > 0 && (
          <Fact icon={PepperIcon}>{m3.spiceLevel[item.spice]}</Fact>
        )}
        {/* The warning below already says it when a tick is needed */}
        {!(unknown && needsAck && !readOnly) && (
          <Fact icon={InformationCircleIcon}>
            {unknown ? c.allergenUnknown : item.allergens!.length ? c.contains(allergenNames(item.allergens!)) : c.declaredNone}
          </Fact>
        )}
      </ul>

      {readOnly ? (
        <div className="mt-8 flex flex-col items-center pb-4 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-paper text-muted ring-1 ring-line">
            <HugeiconsIcon icon={Clock01Icon} size={22} aria-hidden />
          </span>
          <p className="mt-3 font-display text-section font-bold text-ink">{c.soldOutTitle}</p>
          <p className="mt-1 text-body text-muted">{c.soldOutBody}</p>
          <span className="mt-4 rounded-full border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-ink/70">{c.backSoon}</span>
        </div>
      ) : (
        <>
          {banner && <div className="mt-4">{banner}</div>}

          {needsAck && (
            <div role="alert" className="mt-4 rounded-cta bg-[var(--state-seated-soft)] px-4 py-3 ring-1 ring-danger/10 ring-inset">
              <p className="flex items-start gap-2 text-body font-semibold text-danger">
                <HugeiconsIcon icon={Alert02Icon} size={18} className="mt-0.5 shrink-0" aria-hidden />
                {clash.length ? c.clashTitle(allergenNames(clash)) : c.allergenUnknown}
              </p>
              {clash.length > 0 && <p className="mt-1 pl-[26px] text-caption text-ink/75">{c.clashBody(allergenNames(clash))}</p>}
              <label className="mt-2 flex cursor-pointer items-start gap-1 pl-[14px]">
                <span className="-my-2 grid size-11 shrink-0 place-items-center">
                  <input
                    ref={ackRef}
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                    className="size-5 cursor-pointer accent-[var(--danger)]"
                  />
                </span>
                <span className="text-body text-ink">{clash.length ? c.ackClash(allergenNames(clash)) : c.ackUnknown}</span>
              </label>
            </div>
          )}

          {liveGroups.map((g) => (
            <OptionGroup
              key={g.id}
              group={g}
              lang={lang}
              c={c}
              selected={effective}
              showError={attempted && missing?.id === g.id}
              setRef={(el) => {
                if (el) groupRefs.current.set(g.id, el);
                else groupRefs.current.delete(g.id);
              }}
              onChange={(next) => setSelected(next)}
            />
          ))}

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-line/70 pt-4">
            <div>
              <p className="text-body font-bold text-ink">{c.quantity}</p>
              {data.plainQty > 0 && <p className="text-caption text-muted">{c.alreadyInCart(data.plainQty)}</p>}
            </div>
            <Stepper qty={qty} setQty={setQty} name={name} c={c} />
          </div>

          <NoteField note={note} setNote={setNote} c={c} />

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-cta border border-line bg-paper/60 p-3.5">
            <input type="checkbox" checked={personalForPickup} onChange={(e) => setPersonalForPickup(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--brand-main)]" />
            <span className="min-w-0">
              <span className="block text-body font-semibold text-ink">{c.packForPickup}</span>
              <span className="mt-0.5 block text-caption text-muted">{c.packForPickupHelp}</span>
            </span>
          </label>
        </>
      )}
    </>
  );

  const footer = readOnly ? null : (
    <div className="border-t border-line/70 bg-surface px-5 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]">
      {error && (
        <p role="alert" className="mb-2 text-center text-caption font-semibold text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={add}
        disabled={!cta.enabled}
        aria-busy={busy || undefined}
        className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-cta px-5 py-3 text-center text-button font-semibold transition-[transform,background-color] duration-100 ease-natural focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] disabled:active:scale-100 ${
          cta.dimmed ? "bg-[#EFEAE2] text-ink/70 ring-1 ring-line ring-inset" : "bg-brand text-brand-on hover:bg-brand-hover"
        }`}
      >
        {busy && <HugeiconsIcon icon={Loading03Icon} size={20} className="animate-spin" aria-hidden />}
        {cta.label}
      </button>
      {busy && !preview && (
        <div className="mt-1">
          <SlowNotice text={c.slow} />
        </div>
      )}
    </div>
  );

  return (
    <SheetFrame
      label={c.sheetLabel(name)}
      closeLabel={c.close}
      onClose={close}
      preview={!!preview}
      footer={footer}
      lang={lang}
      style={brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties}
    >
      {body}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------------------

function OptionGroup({
  group,
  lang,
  c,
  selected,
  showError,
  setRef,
  onChange,
}: {
  group: Group;
  lang: Lang;
  c: G4Copy;
  selected: Set<string>;
  showError: boolean;
  setRef: (el: HTMLFieldSetElement | null) => void;
  onChange: (next: Set<string>) => void;
}) {
  const rule = groupRule(group);
  const id = useId();
  const chosen = group.modifiers.filter((m) => selected.has(m.id));
  const single = rule.max === 1;
  const full = !single && chosen.length >= rule.max;
  const ruleText =
    rule.kind === "one" ? c.choose.one() : rule.kind === "exact" ? c.choose.exact(rule.min) : rule.kind === "upTo" ? c.choose.upTo(rule.max) : c.choose.range(rule.min, rule.max);

  const toggle = (modId: string) => {
    const next = new Set(selected);
    if (single) {
      const wasOn = next.has(modId);
      for (const m of group.modifiers) next.delete(m.id);
      // An optional single choice can be cleared by tapping it again
      if (!(wasOn && !rule.required)) next.add(modId);
    } else if (next.has(modId)) next.delete(modId);
    else if (!full) next.add(modId);
    onChange(next);
  };

  return (
    <fieldset ref={setRef} aria-describedby={`${id}-rule`} className="mt-5 scroll-mt-4 border-t border-line/70 pt-4">
      <legend className="float-left w-full">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-body font-bold text-ink">{pick(lang, group.nameEn, group.nameHi)}</span>
          <span id={`${id}-rule`} className={`text-caption font-semibold ${showError ? "text-danger" : rule.required ? "text-brand-strong" : "text-muted"}`}>
            {rule.required ? c.required : c.optional} · {ruleText}
          </span>
        </span>
      </legend>
      <div className="clear-both pt-1" role={showError ? "alert" : undefined}>
        {group.modifiers.map((m) => {
          const on = selected.has(m.id);
          const off = !m.isAvailable || (!on && full);
          return (
            <label
              key={m.id}
              className={`flex min-h-12 items-center gap-3 border-b border-line/50 last:border-b-0 ${off ? "cursor-default" : "cursor-pointer"}`}
            >
              <input
                type={single ? "radio" : "checkbox"}
                name={`g-${group.id}`}
                checked={on}
                disabled={off}
                // Radios fire onClick even when already checked, which lets an optional choice be cleared
                onClick={single ? () => toggle(m.id) : undefined}
                onChange={single ? () => {} : () => toggle(m.id)}
                className="size-5 shrink-0 cursor-pointer accent-[var(--brand-main)] disabled:cursor-default"
              />
              <span className={`min-w-0 flex-1 text-body ${m.isAvailable ? "text-ink" : "text-muted line-through decoration-line"}`}>
                {pick(lang, m.nameEn, m.nameHi)}
              </span>
              {!m.isAvailable ? (
                <span className="text-caption font-semibold text-muted">{c.unavailable}</span>
              ) : (
                m.priceDeltaPaise > 0 && <span className="text-body tabular text-muted">+ {formatRupees(m.priceDeltaPaise)}</span>
              )}
            </label>
          );
        })}
        {full && <p className="mt-1.5 text-caption text-muted">{c.upToReached(rule.max)}</p>}
      </div>
    </fieldset>
  );
}

function Stepper({ qty, setQty, name, c }: { qty: number; setQty: (n: number) => void; name: string; c: G4Copy }) {
  const btn =
    "relative grid size-10 place-items-center rounded-[10px] transition-transform duration-100 ease-natural before:absolute before:-inset-0.5 active:scale-90 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setQty(qty - 1)} disabled={qty <= 1} aria-label={c.lessOne(name)} className={`${btn} border border-line bg-surface text-ink disabled:text-line`}>
        <HugeiconsIcon icon={MinusSignIcon} size={18} strokeWidth={2.2} aria-hidden />
      </button>
      <span aria-live="polite" className="min-w-8 text-center text-section font-bold tabular text-ink">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => setQty(qty + 1)}
        disabled={qty >= MAX_QTY}
        aria-label={qty >= MAX_QTY ? `${c.moreOne(name)}. ${c.maxReached}` : c.moreOne(name)}
        className={`${btn} bg-brand text-brand-on disabled:bg-line disabled:text-muted`}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={18} strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  );
}

function NoteField({ note, setNote, c }: { note: string; setNote: (n: string) => void; c: G4Copy }) {
  const count = Array.from(note).length;
  return (
    <div className="mt-5 border-t border-line/70 pt-4">
      <label htmlFor="g4-note" className="text-body font-bold text-ink">
        {c.noteLabel}
      </label>
      <div className="relative mt-2">
        <textarea
          id="g4-note"
          rows={2}
          value={note}
          maxLength={NOTE_MAX}
          placeholder={c.notePlaceholder}
          onChange={(e) => setNote(Array.from(e.target.value).slice(0, NOTE_MAX).join(""))}
          aria-describedby="g4-note-count"
          className="block w-full resize-none rounded-input border border-line bg-surface px-3.5 py-3 pb-6 text-section text-ink outline-none placeholder:text-muted/70 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]"
        />
        <span id="g4-note-count" className="pointer-events-none absolute right-3 bottom-2 text-label tabular text-muted">
          {c.noteCount(count)}
        </span>
      </div>
      <div role="group" aria-label={c.quickNotes} className="mt-3 flex flex-wrap gap-2">
        {QUICK_NOTES.map((chip) => {
          const on = hasQuickNote(note, chip);
          const next = toggleQuickNote(note, chip);
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={on}
              disabled={next === null}
              onClick={() => next !== null && setNote(next)}
              className={`min-h-9 rounded-full border px-3.5 text-caption font-semibold transition-colors duration-150 ease-natural disabled:opacity-50 ${
                on ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface text-ink"
              }`}
            >
              {c.chip[chip]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Fact({ icon, children }: { icon: IconSvgElement; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <HugeiconsIcon icon={icon} size={16} className="mt-px shrink-0 text-muted" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

const NOTICE_TONE = {
  paused: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  bill: "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]",
  danger: "bg-[var(--state-seated-soft)] text-danger",
} as const;

function Notice({ icon, tone, title, body }: { icon: IconSvgElement; tone: keyof typeof NOTICE_TONE; title: string; body?: string }) {
  return (
    <div role="status" className={`flex items-start gap-3 rounded-cta px-4 py-3 ${NOTICE_TONE[tone]}`}>
      <HugeiconsIcon icon={icon} size={20} className="shrink-0" aria-hidden />
      <div>
        <p className="text-body font-semibold">{title}</p>
        {body && <p className="mt-0.5 text-caption text-ink/75">{body}</p>}
      </div>
    </div>
  );
}

function Photo({ src, soldOut }: { src: string; soldOut: boolean }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    // Restaurant photos can live on any host, so this stays a plain image
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={480}
      height={270}
      onError={() => setOk(false)}
      ref={(el) => {
        if (el?.complete && el.naturalWidth === 0) setOk(false);
      }}
      className={`mt-1 aspect-[16/9] w-full rounded-card bg-line/40 object-cover ${soldOut ? "opacity-60 grayscale" : ""}`}
    />
  );
}

/**
 * The sheet: a native modal dialog (focus kept inside, Esc closes), 24px top radius, a drag
 * handle that closes on a downward swipe, content that scrolls inside, and a fixed footer.
 */
function SheetFrame({
  label,
  closeLabel,
  onClose,
  preview,
  footer,
  lang,
  style,
  children,
}: {
  label: string;
  closeLabel: string;
  onClose: () => void;
  preview: boolean;
  footer: ReactNode;
  lang: Lang;
  style: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const start = useRef<number | null>(null);
  // One close per sheet: Esc may arrive as "cancel", as a native "close", or both
  const closing = useRef(false);
  const closeOnce = () => {
    if (closing.current) return;
    closing.current = true;
    // Close the modal first so nothing stays inert behind a sheet kept for Forward navigation
    if (ref.current?.open) ref.current.close();
    onClose();
  };
  const [drag, setDrag] = useState(0);

  // Next keeps a closed sheet mounted but hidden, ready for Forward. Each time it is shown the
  // dialog opens fresh; when hidden it closes quietly so its own "close" does not navigate again.
  useEffect(() => {
    const d = ref.current;
    if (!d || preview) return;
    closing.current = false;
    if (!d.open) d.showModal();
    return () => {
      closing.current = true;
      if (d.open) d.close();
    };
  }, [preview]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    // A press on the close button is a tap, not a drag; capturing it would swallow the click
    if ((e.target as HTMLElement).closest("button")) return;
    start.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
  };
  const onUp = () => {
    start.current = null;
    if (drag > 90) closeOnce();
    else setDrag(0);
  };

  const panel = (
    <div
      lang={lang}
      style={drag ? { ...style, transform: `translateY(${drag}px)` } : style}
      className={`flex max-h-[92dvh] flex-col overflow-hidden rounded-t-sheet bg-surface shadow-[var(--shadow-sheet)] ${drag ? "" : "transition-transform duration-200 ease-natural"}`}
    >
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="relative h-11 shrink-0 touch-none pt-2.5">
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <button
          type="button"
          onClick={closeOnce}
          aria-label={closeLabel}
          className="absolute top-1 right-2 grid size-11 place-items-center rounded-full text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
      {footer}
    </div>
  );

  if (preview) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-ink/40" aria-label={label}>
        {panel}
      </div>
    );
  }
  return (
    <dialog
      ref={ref}
      aria-labelledby="g4-title"
      onCancel={(e) => {
        e.preventDefault();
        closeOnce();
      }}
      // Browsers may close a modal dialog on Esc without a cancelable "cancel" event. A late
      // "close" from an earlier hide arrives while the dialog is open again and is ignored.
      onClose={(e) => !e.currentTarget.open && closeOnce()}
      onClick={(e) => e.target === e.currentTarget && closeOnce()}
      className="m-0 mx-auto mt-auto w-full max-w-[480px] bg-transparent p-0 backdrop:bg-ink/40 open:animate-sheet"
    >
      {panel}
    </dialog>
  );
}
