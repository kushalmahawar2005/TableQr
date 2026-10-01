"use client";

import { ArrowRight01Icon, ShoppingBag01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatRupees } from "@/domain/menu-price";
import type { G3Copy } from "../_copy";

/**
 * My cart only: total quantity and running total, placed above the dining navigation. "View cart"
 * appears only once the cart screen (G5) exists; until then the bar is a plain summary.
 */
export function CartBar({
  count,
  totalPaise,
  pausedBy,
  canOpenCart,
  onOpen,
  c,
}: {
  count: number;
  totalPaise: number;
  /** Set while ordering is paused or the bill is requested */
  pausedBy: string | null;
  canOpenCart: boolean;
  onOpen: () => void;
  c: G3Copy;
}) {
  const total = formatRupees(totalPaise);
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        <HugeiconsIcon icon={pausedBy ? SquareLock02Icon : ShoppingBag01Icon} size={20} className="shrink-0" aria-hidden />
        <span className="min-w-0">
          {pausedBy && <span className="block text-caption font-semibold text-ink/80">{pausedBy}</span>}
          {/* The count ticks with one short pulse when it changes */}
          <span key={count} className="block animate-pulse-once text-body font-bold tabular">
            {c.cartSummary(count, total)}
          </span>
        </span>
      </span>
      {canOpenCart && (
        <span className="flex shrink-0 items-center gap-1 text-body font-bold">
          {c.viewCart}
          <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={2.2} aria-hidden />
        </span>
      )}
    </>
  );
  // Blocked: a quiet neutral surface, never the primary-action look
  const cls = `flex min-h-14 w-full items-center justify-between gap-3 rounded-cta px-4 py-2.5 text-left ${
    pausedBy ? "border border-line bg-[#EFEAE2] text-ink shadow-[var(--shadow-dropdown)]" : "bg-brand text-brand-on shadow-[var(--shadow-float)]"
  }`;

  return (
    <div>
      <div aria-live="polite" className="sr-only">
        {c.cartLabel(count, total)}
      </div>
      {canOpenCart ? (
        <button type="button" onClick={onOpen} aria-label={`${c.cartLabel(count, total)}. ${c.viewCart}`} className={`pointer-events-auto ${cls} transition-transform duration-100 ease-natural active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}>
          {inner}
        </button>
      ) : (
        <div className={`pointer-events-auto ${cls}`}>{inner}</div>
      )}
    </div>
  );
}
