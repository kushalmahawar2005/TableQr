"use client";

import { Cancel01Icon, FavouriteIcon, Location06Icon, SecurityCheckIcon, ToggleOnIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState, type PointerEvent } from "react";
import type { Lang } from "@/lib/i18n";
import { g2Copy } from "../_copy";

const ROW_ICONS = [Location06Icon, FavouriteIcon, ToggleOnIcon];
/** Dragging the sheet down this far closes it */
const CLOSE_AT = 80;

/** "Why we ask for your number" link and its small bottom sheet */
export function WhyAsk({ lang, preview }: { lang: Lang; preview?: boolean }) {
  const copy = g2Copy[lang];
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  const close = () => {
    dialog.current?.close();
    setDrag(0);
  };

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
    if (drag > CLOSE_AT) close();
    else setDrag(0);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => !preview && dialog.current?.showModal()}
        className="-my-2 py-2 text-left text-body font-semibold text-brand-strong underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {copy.whyLink}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="why-title"
        // A tap on the dimmed backdrop lands on the dialog itself
        onClick={(e) => e.target === e.currentTarget && close()}
        onClose={() => setDrag(0)}
        className="m-0 mx-auto mt-auto max-h-[85dvh] w-full max-w-[480px] bg-transparent p-0 backdrop:bg-ink/40 open:animate-sheet"
      >
        <div
          style={drag ? { transform: `translateY(${drag}px)` } : undefined}
          className={drag ? "" : "transition-transform duration-200 ease-natural"}
        >
          <WhySheetPanel
            lang={lang}
            onClose={close}
            dragHandlers={{ onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp }}
          />
        </div>
      </dialog>
    </>
  );
}

/** The sheet itself; also drawn open on the dev review board */
export function WhySheetPanel({
  lang,
  onClose,
  dragHandlers,
}: {
  lang: Lang;
  onClose?: () => void;
  dragHandlers?: Record<string, (e: PointerEvent<HTMLDivElement>) => void>;
}) {
  const c = g2Copy[lang].why;
  return (
    <div className="rounded-t-sheet bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[var(--shadow-sheet)]">
      {/* Drag area: the handle and the header */}
      <div {...dragHandlers} className="touch-none pt-2.5">
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <div className="mt-3 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong">
            <HugeiconsIcon icon={SecurityCheckIcon} size={20} aria-hidden />
          </span>
          <h2 id="why-title" className="min-w-0 flex-1 pt-2 font-display text-section font-bold text-ink">
            {c.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={c.close}
            className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />
          </button>
        </div>
      </div>

      <ul className="mt-5 space-y-4">
        {c.rows.map((r, i) => (
          <li key={r.title} className="flex gap-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong">
              <HugeiconsIcon icon={ROW_ICONS[i]} size={18} strokeWidth={1.8} aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-body font-bold text-ink">{r.title}</p>
              <p className="mt-1 text-caption text-muted">{r.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onClose}
        className="mt-6 flex min-h-12 w-full items-center justify-center rounded-cta border border-line bg-surface px-5 text-button font-semibold text-ink transition-[transform,background-color] duration-100 ease-natural hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98]"
      >
        {c.close}
      </button>
    </div>
  );
}
