"use client";

import { ArrowRight01Icon, MinusSignIcon, PepperIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useState } from "react";
import { formatRupees } from "@/domain/menu-price";
import { MAX_QTY } from "@/domain/pricing";
import type { Lang } from "@/lib/i18n";
import type { MenuRowItem } from "@/server/guest/menu-screen";
import type { G3Copy } from "../_copy";

/** Restaurant content in the guest's language when the restaurant entered it, else English */
export const pick = (lang: Lang, en: string, hi: string | null | undefined) => (lang === "hi" && hi ? hi : en);

/** Square outline with a centre dot, green or red, with its meaning in words for screen readers */
export function VegMark({ veg, label }: { veg: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px] ${veg ? "border-success" : "border-danger"}`}
    >
      <span className={`size-1.5 rounded-full ${veg ? "bg-success" : "bg-danger"}`} />
    </span>
  );
}

export type RowState = {
  /** Plain quantity in my cart (the stepper) */
  qty: number;
  /** Quantity on lines with options, notes or sharing */
  custom: number;
  /** Cart changes are paused (host, bill, offline) */
  blocked: boolean;
  /** Built destinations: the item sheet (G4) */
  canOpenSheet: boolean;
};

const TAG_TONE = {
  bestseller: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  chefs_pick: "bg-brand-soft text-brand-strong",
  new: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
} as const;

/** One dish: words on the left, photo and action on the right. A row grows, it never cuts the price. */
export const MenuRow = memo(function MenuRow({
  item,
  state,
  lang,
  c,
  onQty,
  onOpen,
}: {
  item: MenuRowItem;
  state: RowState;
  lang: Lang;
  c: G3Copy;
  onQty: (itemId: string, qty: number) => void;
  onOpen: (itemId: string) => void;
}) {
  const name = pick(lang, item.nameEn, item.nameHi);
  const description = pick(lang, item.descriptionEn ?? "", item.descriptionHi);
  const price = formatRupees(item.price.paise);
  const soldOut = !item.available;
  const [imageOk, setImageOk] = useState(true);
  const photo = item.imageUrl && imageOk ? item.imageUrl : null;

  const words = (
    <>
      <div className="flex items-center gap-1.5">
        <VegMark veg={item.isVeg} label={item.isVeg ? c.veg : c.nonVeg} />
        {item.isJain && (
          <span className="rounded-[4px] border border-line px-1 text-[10px] leading-3.5 font-semibold text-muted">{c.jainMark}</span>
        )}
        {item.tag && (
          <span className={`rounded-full px-1.5 text-label font-semibold ${TAG_TONE[item.tag]}`}>{c.tag[item.tag]}</span>
        )}
      </div>
      <h3 className="mt-1.5 text-body font-bold text-ink">{name}</h3>
      <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-body font-semibold tabular ${soldOut ? "text-muted" : "text-ink"}`}>
        {item.price.from ? c.from(price) : price}
        {item.spice !== null && item.spice > 0 && (
          <span className="inline-flex items-center gap-0.5 text-caption font-medium text-muted" title={c.spiceLevel[item.spice]}>
            <HugeiconsIcon icon={PepperIcon} size={14} className="text-[var(--state-bill-text)]" aria-hidden />
            {c.spiceLevel[item.spice]}
          </span>
        )}
      </p>
      {description && <p className="mt-1 line-clamp-2 text-caption text-muted">{description}</p>}
    </>
  );

  return (
    // Sold out stays readable: name in ink, price and description muted, photo faded
    <li className="flex gap-4 border-b border-line/70 py-4 last:border-b-0">
      {/* Tapping the dish opens its sheet once the item sheet (G4) exists; until then it is plain text */}
      {state.canOpenSheet ? (
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          {words}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{words}</div>
      )}

      <div className={`flex min-w-[104px] shrink-0 flex-col items-center ${photo ? "" : "justify-center"}`}>
        {photo && (
          // Restaurant photos can live on any host, so this stays a plain lazy image
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
            onError={() => setImageOk(false)}
            // A photo that failed before the page became interactive never fires onError
            ref={(el) => {
              if (el?.complete && el.naturalWidth === 0) setImageOk(false);
            }}
            className={`size-24 rounded-card bg-line/40 object-cover ${soldOut ? "opacity-60 grayscale" : ""}`}
          />
        )}
        {/* Above the photo, which has its own layer when greyed */}
        <div className={`relative z-10 ${photo ? "-mt-4" : ""}`}>
          <RowAction item={item} name={name} state={state} c={c} onQty={onQty} onOpen={onOpen} />
        </div>
      </div>
    </li>
  );
});

function RowAction({
  item,
  name,
  state,
  c,
  onQty,
  onOpen,
}: {
  item: MenuRowItem;
  name: string;
  state: RowState;
  c: G3Copy;
  onQty: (itemId: string, qty: number) => void;
  onOpen: (itemId: string) => void;
}) {
  if (!item.available) {
    return (
      <span role="status" aria-label={c.soldOut(name)} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-ink/70">
        {c.backSoon}
      </span>
    );
  }

  // Below the button, so it never sits on the photo
  const inCart = state.custom > 0 && <span className="mt-1 block text-center text-label font-semibold text-brand-strong">{c.inCart(state.custom + state.qty)}</span>;
  const blockedNote = state.blocked ? c.blockedReason : undefined;

  // A required choice goes through the item sheet
  if (item.options === "required") {
    return (
      <div className="flex flex-col items-center">
        <OutlineButton
          label={c.choose}
          ariaLabel={c.chooseFor(name)}
          disabled={state.blocked || !state.canOpenSheet}
          note={blockedNote}
          onClick={() => onOpen(item.id)}
          icon={ArrowRight01Icon}
        />
        {inCart}
      </div>
    );
  }

  if (state.qty === 0) {
    return (
      <div className="flex flex-col items-center">
        <OutlineButton
          label={c.add}
          ariaLabel={c.addOne(name)}
          disabled={state.blocked}
          note={blockedNote}
          onClick={() => onQty(item.id, 1)}
          icon={PlusSignIcon}
        />
        {inCart}
      </div>
    );
  }

  const atMax = state.qty >= MAX_QTY;
  return (
    <div className="flex flex-col items-center">
      <div
        role="group"
        aria-label={c.qtyOf(state.qty, name)}
        className={`flex min-h-9 min-w-[96px] items-center justify-between gap-1 rounded-[10px] text-brand-on shadow-[0_1px_2px_rgb(31_41_55/0.12)] ${state.blocked ? "bg-muted" : "bg-brand"}`}
      >
        <StepButton icon={MinusSignIcon} label={c.removeOne(name)} disabled={state.blocked} note={blockedNote} onClick={() => onQty(item.id, state.qty - 1)} />
        <span aria-live="polite" className="min-w-6 text-center text-body font-bold tabular">
          {state.qty}
        </span>
        <StepButton
          icon={PlusSignIcon}
          label={c.addOne(name)}
          disabled={state.blocked || atMax}
          note={atMax ? c.maxReached : blockedNote}
          onClick={() => onQty(item.id, state.qty + 1)}
        />
      </div>
      {inCart}
      {atMax && <span className="mt-1 text-label text-muted">{c.maxReached}</span>}
    </div>
  );
}

/** Drawn 36 tall, with a 44px tap area */
function OutlineButton({
  label,
  ariaLabel,
  disabled,
  note,
  onClick,
  icon,
}: {
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  note?: string;
  onClick: () => void;
  icon: typeof PlusSignIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={note ? `${ariaLabel}. ${note}` : ariaLabel}
      className="relative flex min-h-9 min-w-[96px] items-center justify-center gap-1 rounded-[10px] px-3 py-1 border border-brand-border bg-surface text-body font-bold text-brand-strong shadow-[0_1px_2px_rgb(31_41_55/0.08)] transition-[transform,background-color] duration-100 ease-natural before:absolute before:-inset-1 hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.97] disabled:cursor-default disabled:border-line disabled:text-muted disabled:shadow-none disabled:hover:bg-surface disabled:active:scale-100"
    >
      {label}
      <HugeiconsIcon icon={icon} size={16} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  note,
  onClick,
}: {
  icon: typeof PlusSignIcon;
  label: string;
  disabled?: boolean;
  note?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={note ? `${label}. ${note}` : label}
      className="relative grid h-full w-9 place-items-center transition-transform duration-100 ease-natural before:absolute before:-inset-x-1 before:-inset-y-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white active:scale-90 disabled:opacity-50 disabled:active:scale-100"
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={2.4} aria-hidden />
    </button>
  );
}
