// Kitchen rules (PS 5.1, 5.2).

export type LineStatus = "placed" | "accepted" | "preparing" | "ready" | "served" | "cancelled" | "voided";
export type OrderStatus = "placed" | "accepted" | "preparing" | "ready" | "served" | "cancelled";

const RANK: Record<Exclude<LineStatus, "cancelled" | "voided">, number> = {
  placed: 0,
  accepted: 1,
  preparing: 2,
  ready: 3,
  served: 4,
};

/**
 * An order's status follows its lines, which move independently because different
 * stations cook them. It is only as far along as its slowest live line, except that
 * any line cooking or done makes the whole order "preparing" for the guest.
 */
export function deriveOrderStatus(lines: LineStatus[]): OrderStatus {
  const live = lines.filter((l): l is keyof typeof RANK => l !== "cancelled" && l !== "voided");
  if (live.length === 0) return "cancelled";
  const min = Math.min(...live.map((l) => RANK[l]));
  const max = Math.max(...live.map((l) => RANK[l]));
  if (min >= RANK.served) return "served";
  if (min >= RANK.ready) return "ready";
  if (max >= RANK.preparing) return "preparing";
  if (min >= RANK.accepted) return "accepted";
  return "placed";
}

export type Urgency = "new" | "on_time" | "getting_late" | "late";

/**
 * Ticket colour on the KDS: amber at the target prep time, red at 1.5 times it.
 * A ticket nobody has started yet shows as new until it reaches its target.
 */
export function ticketUrgency(elapsedMs: number, targetMinutes: number, started: boolean): Urgency {
  const target = targetMinutes * 60_000;
  if (elapsedMs >= target * 1.5) return "late";
  if (elapsedMs >= target) return "getting_late";
  return started ? "on_time" : "new";
}

/** A bumped ticket can be recalled for this long if it was bumped by mistake */
export const RECALL_WINDOW_MS = 10 * 60_000;

/** Guest-facing words for each state (PS 5.1) */
export const GUEST_STATUS_TEXT: Record<OrderStatus, string> = {
  placed: "Order received",
  accepted: "Kitchen confirmed",
  preparing: "Being prepared",
  ready: "Ready, coming to your table",
  served: "Served",
  cancelled: "Cancelled",
};

/** Sort weight: late first, then getting late, then everything on time */
export const urgencyRank = (u: Urgency) => (u === "late" ? 3 : u === "getting_late" ? 2 : 0);
