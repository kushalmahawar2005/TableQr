"use client";

import { ArrowRight01Icon, MinusSignIcon, PepperIcon, PlusSignIcon, Restaurant01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useState } from "react";
import { formatRupees } from "@/domain/menu-price";
import { menuThumb } from "@/domain/menu-photo";
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
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted">
        <VegMark veg={item.isVeg} label={item.isVeg ? c.veg : c.nonVeg} />
        <span aria-hidden className="font-medium">{item.isVeg ? c.diet.veg : c.diet.non_veg}</span>
        {item.spice !== null && item.spice > 0 && (
          <>
            <span aria-hidden>•</span>
            <span className="inline-flex items-center gap-0.5 font-medium">
              <HugeiconsIcon icon={PepperIcon} size={13} className="text-[var(--state-bill-text)]" aria-hidden />
              {c.spiceLevel[item.spice]}
            </span>
          </>
        )}
        {item.isJain && (
          <span className="rounded-[4px] border border-line px-1 text-[10px] leading-3.5 font-semibold text-muted">{c.jainMark}</span>
        )}
        {item.tag && (
          <span className={`rounded-full px-1.5 text-label font-semibold ${TAG_TONE[item.tag]}`}>{c.tag[item.tag]}</span>
        )}
      </div>
      <h3 className="mt-1 font-display text-[1.0625rem] leading-snug font-bold text-ink">{name}</h3>
      {description && <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-muted">{description}</p>}
      {/* Room on the right for the Add button, which sits on this line */}
      <p className={`mt-auto flex min-h-10 items-end pt-1.5 pr-[116px] font-display text-section font-bold tabular ${soldOut ? "text-muted" : "text-ink"}`}>
        {item.price.from ? c.from(price) : price}
      </p>
    </>
  );

  const thumb = (
    <Thumb photo={photo} soldOut={soldOut} size="size-[104px] min-[380px]:size-[112px]" onError={() => setImageOk(false)} />
  );

  return (
    // Sold out stays readable: name in ink, price and description muted, photo faded
    <li className="relative mb-3 rounded-[20px] border border-line/60 bg-surface p-3 shadow-[0_2px_12px_rgb(31_41_55/0.05)]">
      {state.canOpenSheet ? (
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="flex w-full min-w-0 gap-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          {thumb}
          <span className="flex min-w-0 flex-1 flex-col">{words}</span>
        </button>
      ) : (
        <div className="flex min-w-0 gap-3.5">
          {thumb}
          <div className="flex min-w-0 flex-1 flex-col">{words}</div>
        </div>
      )}
      <div className="absolute right-3 bottom-3 flex flex-col items-end">
        <RowAction item={item} name={name} state={state} c={c} onQty={onQty} onOpen={onOpen} />
      </div>
    </li>
  );
});

/** Dish photo (its small copy, falling back to the full photo), or a plate icon when there is none */
export function Thumb({ photo, soldOut, size, onError }: { photo: string | null; soldOut?: boolean; size: string; onError?: () => void }) {
  const [smallFailed, setSmallFailed] = useState(false);
  const small = menuThumb(photo);
  const src = smallFailed ? photo : small;
  const fail = () => (src !== photo ? setSmallFailed(true) : onError?.());
  return src ? (
    // Restaurant photos can live on any host, so this stays a plain lazy image
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={fail}
      ref={(el) => {
        if (el?.complete && el.naturalWidth === 0) fail();
      }}
      className={`${size} shrink-0 rounded-2xl bg-line/40 object-cover ${soldOut ? "opacity-60 grayscale" : ""}`}
    />
  ) : (
    <span aria-hidden className={`${size} grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-soft to-paper text-brand/60`}>
      <HugeiconsIcon icon={Restaurant01Icon} size={30} strokeWidth={1.5} />
    </span>
  );
}

/** Popular row: a larger card with the photo on top, scrolled sideways */
export const PopularCard = memo(function PopularCard({
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
  const price = formatRupees(item.price.paise);
  const [imageOk, setImageOk] = useState(true);
  const photo = item.imageUrl && imageOk ? item.imageUrl : null;
  const body = (
    <>
      <Thumb photo={photo} soldOut={!item.available} size="aspect-[4/3] w-full" onError={() => setImageOk(false)} />
      <span className="mt-2 flex items-center gap-1.5">
        <VegMark veg={item.isVeg} label={item.isVeg ? c.veg : c.nonVeg} />
        <span className="line-clamp-1 text-body font-bold text-ink">{name}</span>
      </span>
    </>
  );
  return (
    <li className="w-44 shrink-0 rounded-[20px] border border-line/60 bg-surface p-2.5 shadow-[0_2px_12px_rgb(31_41_55/0.05)]">
      {state.canOpenSheet ? (
        <button type="button" onClick={() => onOpen(item.id)} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          {body}
        </button>
      ) : (
        <div>{body}</div>
      )}
      <p className={`mt-1 font-display text-section font-bold tabular ${item.available ? "text-ink" : "text-muted"}`}>{item.price.from ? c.from(price) : price}</p>
      <div className="mt-2 flex justify-end">
        <RowAction item={item} name={name} state={state} c={c} onQty={onQty} onOpen={onOpen} />
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
        <button
          type="button"
          onClick={() => onQty(item.id, 1)}
          disabled={state.blocked}
          aria-label={blockedNote ? `${c.addOne(name)}. ${blockedNote}` : c.addOne(name)}
          className="relative flex h-10 min-w-[96px] items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-body font-bold text-brand-on transition-[transform,background-color] duration-100 ease-natural before:absolute before:-inset-1 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.96] disabled:cursor-default disabled:bg-line disabled:text-muted"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={17} strokeWidth={2.6} aria-hidden />
          {c.add}
        </button>
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
        className={`flex h-10 min-w-[96px] items-center justify-between gap-1 rounded-xl text-brand-on ${state.blocked ? "bg-muted" : "bg-brand"}`}
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
      className="relative flex h-10 min-w-[96px] items-center justify-center gap-1 rounded-xl px-3 py-1 border border-brand-border bg-surface text-body font-bold text-brand-strong shadow-[0_1px_2px_rgb(31_41_55/0.08)] transition-[transform,background-color] duration-100 ease-natural before:absolute before:-inset-1 hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.97] disabled:cursor-default disabled:border-line disabled:text-muted disabled:hover:bg-surface disabled:active:scale-100"
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
