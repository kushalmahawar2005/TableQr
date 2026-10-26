"use client";

import { ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useRef, type ReactNode } from "react";
import { ALLERGEN_LABELS, ALLERGENS, type Allergen, type SpiceLevel } from "@/domain/allergens";
import { hasActiveFilters, NO_FILTERS, type DietChoice, type MenuFilters } from "@/domain/menu-filter";
import type { Lang } from "@/lib/i18n";
import type { G3Copy } from "../_copy";

// The list a guest can avoid: everything except "Other / unknown", which only describes data
const AVOIDABLE = ALLERGENS.filter((a) => a !== "other");
const SPICE_STEPS: SpiceLevel[] = [0, 1, 2];

/** All · Veg · Non-veg, Jain, then Spice and Avoid allergens, which open small sheets */
export function FilterBar({
  filters,
  onChange,
  lang,
  c,
  openSheet,
  allRef,
}: {
  filters: MenuFilters;
  onChange: (f: MenuFilters) => void;
  lang: Lang;
  c: G3Copy;
  /** Dev board: draw one sheet open */
  openSheet?: "spice" | "allergens";
  /** The filter button in the search box opens every filter in one sheet */
  allRef?: React.RefObject<HTMLDialogElement | null>;
}) {
  const spiceRef = useRef<HTMLDialogElement>(null);
  const allergenRef = useRef<HTMLDialogElement>(null);
  const diets: DietChoice[] = ["all", "veg", "non_veg"];

  return (
    <>
      {/* Fades at the right edge so a cut-off chip reads as "more this way" */}
      <div role="group" aria-label={c.filtersLabel} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] [scrollbar-width:none] min-[360px]:-mx-5 min-[360px]:px-5">
        {diets.map((d) => (
          <Chip key={d} active={filters.diet === d} onClick={() => onChange({ ...filters, diet: d })}>
            {c.diet[d]}
          </Chip>
        ))}
        <Chip active={filters.jainOnly} onClick={() => onChange({ ...filters, jainOnly: !filters.jainOnly })}>
          {c.jain}
        </Chip>
        <Chip active={filters.maxSpice !== null} menu onClick={() => spiceRef.current?.showModal()}>
          {filters.maxSpice !== null ? c.spiceChoice[filters.maxSpice] : c.spice}
        </Chip>
        <Chip active={filters.avoid.length > 0} menu onClick={() => allergenRef.current?.showModal()}>
          {filters.avoid.length ? c.allergensActive(filters.avoid.length) : c.allergens}
        </Chip>
      </div>

      <Sheet refEl={spiceRef} title={c.spiceSheetTitle} note={c.spiceSheetNote} c={c} preview={openSheet === "spice"}>
        <fieldset>
          <legend className="sr-only">{c.spiceSheetTitle}</legend>
          {[null, ...SPICE_STEPS].map((level) => (
            <label key={String(level)} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line/70 last:border-b-0">
              <input
                type="radio"
                name="max-spice"
                checked={filters.maxSpice === level}
                onChange={() => onChange({ ...filters, maxSpice: level })}
                className="size-5 accent-[var(--brand-main)]"
              />
              <span className="text-body text-ink">{level === null ? c.spiceAny : c.spiceChoice[level]}</span>
            </label>
          ))}
        </fieldset>
      </Sheet>

      <Sheet
        refEl={allergenRef}
        title={c.allergenSheetTitle}
        note={c.allergenSheetNote}
        c={c}
        preview={openSheet === "allergens"}
        onReset={filters.avoid.length ? () => onChange({ ...filters, avoid: [] }) : undefined}
      >
        <fieldset className="grid grid-cols-2 gap-x-3">
          <legend className="sr-only">{c.allergenSheetTitle}</legend>
          {AVOIDABLE.map((a: Allergen) => (
            <label key={a} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line/70">
              <input
                type="checkbox"
                checked={filters.avoid.includes(a)}
                onChange={(e) =>
                  onChange({ ...filters, avoid: e.target.checked ? [...filters.avoid, a] : filters.avoid.filter((x) => x !== a) })
                }
                className="size-5 accent-[var(--brand-main)]"
              />
              <span className="text-body text-ink">{ALLERGEN_LABELS[a][lang]}</span>
            </label>
          ))}
        </fieldset>
      </Sheet>

      {allRef && (
        <Sheet refEl={allRef} title={c.allFilters} note={c.allFiltersNote} c={c} onReset={hasActiveFilters(filters) ? () => onChange(NO_FILTERS) : undefined}>
          <div className="max-h-[52dvh] space-y-5 overflow-y-auto">
            <fieldset>
              <legend className="text-caption font-semibold text-muted">{c.dietTitle}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {diets.map((d) => (
                  <Chip key={d} active={filters.diet === d} onClick={() => onChange({ ...filters, diet: d })}>
                    {c.diet[d]}
                  </Chip>
                ))}
                <Chip active={filters.jainOnly} onClick={() => onChange({ ...filters, jainOnly: !filters.jainOnly })}>
                  {c.jain}
                </Chip>
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-caption font-semibold text-muted">{c.spiceSheetTitle}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[null, ...SPICE_STEPS].map((level) => (
                  <Chip key={String(level)} active={filters.maxSpice === level} onClick={() => onChange({ ...filters, maxSpice: level })}>
                    {level === null ? c.spiceAny : c.spiceChoice[level]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-caption font-semibold text-muted">{c.allergenSheetTitle}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {AVOIDABLE.map((a: Allergen) => (
                  <Chip
                    key={a}
                    active={filters.avoid.includes(a)}
                    onClick={() => onChange({ ...filters, avoid: filters.avoid.includes(a) ? filters.avoid.filter((x) => x !== a) : [...filters.avoid, a] })}
                  >
                    {ALLERGEN_LABELS[a][lang]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </div>
        </Sheet>
      )}
    </>
  );
}

function Chip({ active, menu, onClick, children }: { active: boolean; menu?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={menu ? undefined : active}
      aria-haspopup={menu ? "dialog" : undefined}
      onClick={onClick}
      className={`flex h-9 shrink-0 items-center gap-1 rounded-full border px-3.5 text-caption font-semibold whitespace-nowrap transition-colors duration-150 ease-natural focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active ? "border-brand bg-brand text-brand-on shadow-[0_2px_8px_var(--brand-soft)]" : "border-line/70 bg-surface text-ink shadow-[0_1px_3px_rgb(31_41_55/0.05)] hover:border-ink/30"
      }`}
    >
      {children}
      {menu && <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} aria-hidden />}
    </button>
  );
}

/** Small bottom sheet on the native dialog: Esc, backdrop tap and a Close button all close it */
function Sheet({
  refEl,
  title,
  note,
  c,
  preview,
  onReset,
  children,
}: {
  refEl: React.RefObject<HTMLDialogElement | null>;
  title: string;
  note: string;
  c: G3Copy;
  preview?: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const close = () => refEl.current?.close();
  const body = (
    <div className="rounded-t-sheet bg-surface px-5 pt-2.5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[var(--shadow-sheet)]">
      <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <h2 id={titleId} className="font-display text-section font-bold text-ink">
          {title}
        </h2>
        <button type="button" onClick={close} aria-label={c.close} className="-mr-2 grid size-11 place-items-center rounded-full text-muted hover:text-ink">
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-caption text-muted">{note}</p>
      <div className="mt-3">{children}</div>
      <div className="mt-5 flex gap-3">
        {onReset && (
          <button type="button" onClick={onReset} className="min-h-12 flex-1 rounded-cta border border-line bg-surface text-button font-semibold text-ink">
            {c.reset}
          </button>
        )}
        <button type="button" onClick={close} className="min-h-12 flex-[2] rounded-cta bg-brand text-button font-semibold text-brand-on">
          {c.apply}
        </button>
      </div>
    </div>
  );

  if (preview) {
    return <div className="fixed inset-0 z-40 flex flex-col justify-end bg-ink/40">{body}</div>;
  }
  return (
    <dialog
      ref={refEl}
      aria-labelledby={titleId}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="m-0 mx-auto mt-auto max-h-[85dvh] w-full max-w-[480px] bg-transparent p-0 backdrop:bg-ink/40 open:animate-sheet"
    >
      {body}
    </dialog>
  );
}
