import { roundHalfUp, roundToRupee } from "./money";

// Bill split rules from PS 3.6. Pure: the caller loads lines and participants.

export type SplitLine = {
  id: string;
  /** Who ordered it; the line belongs to them unless shared */
  ownerId: string;
  /** unit price x qty, after any item-level discount, in paise */
  amountPaise: number;
  taxRateBp: number;
  /** People sharing the line, in table order; null or empty means not shared */
  sharedWith?: string[] | null;
};

export type SplitInput = {
  /** Payers in table order; the host is the one who absorbs the round-off difference */
  participantIds: string[];
  hostId: string;
  lines: SplitLine[];
  /** Bill-level discount in paise, applied before tax, in proportion to subtotals */
  billDiscountPaise?: number;
  /** Optional service charge as basis points of the discounted subtotal */
  serviceChargeBp?: number;
};

export type PersonShare = {
  participantId: string;
  ownItemsPaise: number;
  sharedItemsPaise: number;
  subtotalPaise: number;
  discountPaise: number;
  serviceChargePaise: number;
  taxPaise: number;
  /** Exact amount before rounding to the rupee */
  exactPaise: number;
  roundOffPaise: number;
  /** What this person pays, a whole rupee amount in paise */
  amountPaise: number;
};

export type BillTotals = {
  subtotalPaise: number;
  discountPaise: number;
  serviceChargePaise: number;
  taxPaise: number;
  /** Tax per rate, keyed by basis points */
  taxBreakup: Record<string, number>;
  exactPaise: number;
  roundOffPaise: number;
  totalPaise: number;
};

type Portion = { participantId: string; amountPaise: number; taxRateBp: number; shared: boolean };

/** Divides a line among its sharers; leftover paise go to the first person in the list */
function portionsOf(line: SplitLine): Portion[] {
  const sharers = line.sharedWith?.length ? line.sharedWith : null;
  if (!sharers) {
    return [{ participantId: line.ownerId, amountPaise: line.amountPaise, taxRateBp: line.taxRateBp, shared: false }];
  }
  const each = Math.floor(line.amountPaise / sharers.length);
  const leftover = line.amountPaise - each * sharers.length;
  return sharers.map((participantId, i) => ({
    participantId,
    amountPaise: each + (i === 0 ? leftover : 0),
    taxRateBp: line.taxRateBp,
    shared: true,
  }));
}

/** Splits an amount in proportion to weights; remainder paise go to the largest weights first */
function proportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    parts[i] += 1;
    rest -= 1;
  }
  return parts;
}

/** Table totals, independent of how the bill is split */
export function billTotals(input: Omit<SplitInput, "participantIds" | "hostId">): BillTotals {
  const subtotalPaise = input.lines.reduce((s, l) => s + l.amountPaise, 0);
  const discountPaise = Math.min(input.billDiscountPaise ?? 0, subtotalPaise);
  const factor = subtotalPaise === 0 ? 0 : (subtotalPaise - discountPaise) / subtotalPaise;

  const taxBreakup: Record<string, number> = {};
  for (const line of input.lines) {
    const key = String(line.taxRateBp);
    taxBreakup[key] = (taxBreakup[key] ?? 0) + (line.amountPaise * factor * line.taxRateBp) / 10000;
  }
  for (const key of Object.keys(taxBreakup)) taxBreakup[key] = roundHalfUp(taxBreakup[key]);
  const taxPaise = Object.values(taxBreakup).reduce((a, b) => a + b, 0);

  const serviceChargePaise = roundHalfUp(((subtotalPaise - discountPaise) * (input.serviceChargeBp ?? 0)) / 10000);
  const exactPaise = subtotalPaise - discountPaise + serviceChargePaise + taxPaise;
  const totalPaise = roundToRupee(exactPaise);
  return {
    subtotalPaise,
    discountPaise,
    serviceChargePaise,
    taxPaise,
    taxBreakup,
    exactPaise,
    roundOffPaise: totalPaise - exactPaise,
    totalPaise,
  };
}

/** "My items" split: each person pays their own lines plus their part of shared lines */
export function splitByItems(input: SplitInput): { totals: BillTotals; shares: PersonShare[] } {
  const totals = billTotals(input);
  const ids = input.participantIds;
  if (!ids.includes(input.hostId)) throw new Error("Host must be one of the participants");

  const portions = input.lines.flatMap(portionsOf);
  for (const p of portions) {
    if (!ids.includes(p.participantId)) throw new Error(`Line assigned to unknown participant ${p.participantId}`);
  }

  const sum = (id: string, pred: (p: Portion) => boolean) =>
    portions.filter((p) => p.participantId === id && pred(p)).reduce((s, p) => s + p.amountPaise, 0);

  const subtotals = ids.map((id) => sum(id, () => true));
  const discounts = proportional(totals.discountPaise, subtotals);
  const serviceCharges = proportional(totals.serviceChargePaise, subtotals);
  const factor = totals.subtotalPaise === 0 ? 0 : (totals.subtotalPaise - totals.discountPaise) / totals.subtotalPaise;

  const shares: PersonShare[] = ids.map((participantId, i) => {
    const taxPaise = roundHalfUp(
      portions
        .filter((p) => p.participantId === participantId)
        .reduce((s, p) => s + (p.amountPaise * factor * p.taxRateBp) / 10000, 0),
    );
    const exactPaise = subtotals[i] - discounts[i] + serviceCharges[i] + taxPaise;
    const amountPaise = roundToRupee(exactPaise);
    return {
      participantId,
      ownItemsPaise: sum(participantId, (p) => !p.shared),
      sharedItemsPaise: sum(participantId, (p) => p.shared),
      subtotalPaise: subtotals[i],
      discountPaise: discounts[i],
      serviceChargePaise: serviceCharges[i],
      taxPaise,
      exactPaise,
      roundOffPaise: amountPaise - exactPaise,
      amountPaise,
    };
  });

  // Rounded shares must add up to the rounded bill; the host carries any difference
  const diff = totals.totalPaise - shares.reduce((s, x) => s + x.amountPaise, 0);
  if (diff !== 0) {
    const host = shares.find((s) => s.participantId === input.hostId)!;
    host.amountPaise += diff;
    host.roundOffPaise += diff;
  }
  return { totals, shares };
}

/** Equal split of the rounded bill in whole rupees; extra rupees go to the first payers */
export function splitEqually(totalPaise: number, participantIds: string[]): { participantId: string; amountPaise: number }[] {
  if (participantIds.length === 0) throw new Error("No payers");
  const rupees = totalPaise / 100;
  const base = Math.floor(rupees / participantIds.length);
  const extra = rupees - base * participantIds.length;
  return participantIds.map((participantId, i) => ({
    participantId,
    amountPaise: (base + (i < extra ? 1 : 0)) * 100,
  }));
}

/** Custom amounts typed by the host; returns what is still unassigned (negative means over) */
export function customRemaining(totalPaise: number, amounts: { participantId: string; amountPaise: number }[]): number {
  return totalPaise - amounts.reduce((s, a) => s + a.amountPaise, 0);
}

// ---- The whole table bill (G8) ----

export type SplitMode = "my_items" | "equal" | "custom";

export type BillPerson = {
  id: string;
  /** Removed by the host: keeps what they ordered, never handed to someone else (G7/G8 decision) */
  removed: boolean;
  /** Paid and left: this amount is final; later changes never touch it */
  frozenAmountPaise: number | null;
};

export type ShareBasis = "items" | "equal" | "custom" | "frozen";

export type TableShare = {
  participantId: string;
  basis: ShareBasis;
  amountPaise: number;
  /** Item breakdown when the share comes from items (My items, Custom, or a removed person) */
  detail: PersonShare | null;
};

export type BillSplitInput = {
  /** Everyone who ever sat at the table, in joining order */
  people: BillPerson[];
  /** Absorbs the difference between rounded shares and the rounded bill */
  hostId: string | null;
  lines: SplitLine[];
  billDiscountPaise?: number;
  serviceChargeBp?: number;
  mode: SplitMode;
  /** Custom split: participant id to the paise the host set for them (whole rupees) */
  customAmounts?: Record<string, number> | null;
};

/** What a Custom split must add up to, and who it is entered for */
export type CustomSplit = {
  /** People the host sets an amount for: still at the table and not paid-and-left */
  ids: string[];
  /** The rounded bill minus frozen shares and what removed people owe for their own items */
  targetPaise: number;
  /** The saved amounts stand: one whole-rupee amount per person, adding up exactly to the target */
  valid: boolean;
};

/** Checks custom amounts against a target: whole rupees, only these people, exact total */
export function customAmountsValid(ids: string[], targetPaise: number, amounts: Record<string, number> | null | undefined): boolean {
  if (!amounts) return false;
  const keys = Object.keys(amounts);
  if (keys.length !== ids.length || ids.some((id) => !(id in amounts))) return false;
  const values = ids.map((id) => amounts[id]);
  if (values.some((v) => !Number.isInteger(v) || v < 0 || v % 100 !== 0)) return false;
  return values.reduce((a, b) => a + b, 0) === targetPaise;
}

/**
 * Splits the table bill. Frozen shares stay exactly as they were; everything else (the rounded
 * bill minus frozen shares) is divided by the chosen mode:
 * - My items: own lines plus an equal part of shared lines (PS 3.6 calculation rules)
 * - Custom: the host sets a whole-rupee amount per person still at the table; removed people keep
 *   their own items. Amounts stand only while they add up exactly; otherwise My items applies.
 * - Equal: removed people keep their own items; the rest is divided equally among people still at the table
 * Shares always add up exactly to the rounded bill.
 */
export function splitBill(input: BillSplitInput): { totals: BillTotals; shares: TableShare[]; custom: CustomSplit } {
  const totals = billTotals({ lines: input.lines, billDiscountPaise: input.billDiscountPaise, serviceChargeBp: input.serviceChargeBp });
  const known = new Set(input.people.map((p) => p.id));
  const frozen = new Set(input.people.filter((p) => p.frozenAmountPaise !== null).map((p) => p.id));
  const open = input.people.filter((p) => !frozen.has(p.id));
  const eligible = open.filter((p) => !p.removed);

  const portions = input.lines.flatMap(portionsOf);
  for (const p of portions) {
    if (!known.has(p.participantId)) throw new Error(`Line assigned to unknown participant ${p.participantId}`);
  }
  const ids = input.people.map((p) => p.id);
  const sum = (id: string, pred: (p: Portion) => boolean) =>
    portions.filter((p) => p.participantId === id && pred(p)).reduce((s, p) => s + p.amountPaise, 0);
  const subtotals = ids.map((id) => sum(id, () => true));
  const discounts = proportional(totals.discountPaise, subtotals);
  const serviceCharges = proportional(totals.serviceChargePaise, subtotals);
  const factor = totals.subtotalPaise === 0 ? 0 : (totals.subtotalPaise - totals.discountPaise) / totals.subtotalPaise;

  const itemized = new Map<string, PersonShare>();
  ids.forEach((participantId, i) => {
    const taxPaise = roundHalfUp(
      portions.filter((p) => p.participantId === participantId).reduce((s, p) => s + (p.amountPaise * factor * p.taxRateBp) / 10000, 0),
    );
    const exactPaise = subtotals[i] - discounts[i] + serviceCharges[i] + taxPaise;
    const amountPaise = roundToRupee(exactPaise);
    itemized.set(participantId, {
      participantId,
      ownItemsPaise: sum(participantId, (p) => !p.shared),
      sharedItemsPaise: sum(participantId, (p) => p.shared),
      subtotalPaise: subtotals[i],
      discountPaise: discounts[i],
      serviceChargePaise: serviceCharges[i],
      taxPaise,
      exactPaise,
      roundOffPaise: amountPaise - exactPaise,
      amountPaise,
    });
  });

  const frozenTotal = input.people.reduce((s, p) => s + (p.frozenAmountPaise ?? 0), 0);
  const remainder = totals.totalPaise - frozenTotal;
  const shares = new Map<string, TableShare>();
  for (const p of input.people) {
    if (p.frozenAmountPaise !== null) shares.set(p.id, { participantId: p.id, basis: "frozen", amountPaise: p.frozenAmountPaise, detail: null });
  }

  const removedOpen = open.filter((x) => x.removed);
  const removedItems = removedOpen.reduce((n, p) => n + itemized.get(p.id)!.amountPaise, 0);
  const custom: CustomSplit = { ids: eligible.map((p) => p.id), targetPaise: remainder - removedItems, valid: false };
  custom.valid = eligible.length > 0 && customAmountsValid(custom.ids, custom.targetPaise, input.customAmounts);

  if (input.mode === "custom" && custom.valid) {
    for (const p of removedOpen) {
      const d = itemized.get(p.id)!;
      shares.set(p.id, { participantId: p.id, basis: "items", amountPaise: d.amountPaise, detail: { ...d } });
    }
    for (const p of eligible) shares.set(p.id, { participantId: p.id, basis: "custom", amountPaise: input.customAmounts![p.id], detail: null });
  } else if (input.mode === "equal" && eligible.length > 0) {
    let rest = remainder;
    for (const p of open.filter((x) => x.removed)) {
      const d = itemized.get(p.id)!;
      shares.set(p.id, { participantId: p.id, basis: "items", amountPaise: d.amountPaise, detail: { ...d } });
      rest -= d.amountPaise;
    }
    for (const e of splitEqually(Math.max(0, rest), eligible.map((p) => p.id))) {
      shares.set(e.participantId, { participantId: e.participantId, basis: "equal", amountPaise: e.amountPaise, detail: null });
    }
  } else {
    for (const p of open) {
      const d = itemized.get(p.id)!;
      shares.set(p.id, { participantId: p.id, basis: "items", amountPaise: d.amountPaise, detail: { ...d } });
    }
    // Rounded shares must add up to the rounded bill; the host carries any difference
    const diff = remainder - open.reduce((s, p) => s + shares.get(p.id)!.amountPaise, 0);
    const adjuster = eligible.find((p) => p.id === input.hostId) ?? eligible[0] ?? open[0];
    if (diff !== 0 && adjuster) {
      const share = shares.get(adjuster.id)!;
      share.amountPaise += diff;
      if (share.detail) share.detail = { ...share.detail, amountPaise: share.amountPaise, roundOffPaise: share.detail.roundOffPaise + diff };
    }
  }
  return { totals, shares: input.people.map((p) => shares.get(p.id)!), custom };
}
