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
