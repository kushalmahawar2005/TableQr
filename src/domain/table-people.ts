import { isPlaceholderName } from "./guest-name";

// Table & People (G7): who is at the table and what the table has ordered, as guests see it.
// Pure, so the rules are tested without a database.

export type PersonState = "active" | "paid";

export type TablePerson = {
  id: string;
  /** Real first name, or null for a stand-in like "Guest 2", which is never shown */
  name: string | null;
  isMe: boolean;
  isHost: boolean;
  state: PersonState;
};

type Row = { id: string; displayName: string; paidOutAt: Date | null; removedAt: Date | null; joinedAt: Date };

/**
 * The people list: removed people are left out entirely, the active ones come first (host, then
 * you, then in joining order) and people who paid and left go last.
 */
export function tablePeople(rows: Row[], me: string, hostId: string | null): TablePerson[] {
  const people = rows
    .filter((r) => !r.removedAt)
    .map((r) => ({
      id: r.id,
      name: isPlaceholderName(r.displayName) ? null : r.displayName,
      isMe: r.id === me,
      isHost: r.id === hostId,
      state: (r.paidOutAt ? "paid" : "active") as PersonState,
      joinedAt: r.joinedAt.getTime(),
    }));
  const rank = (p: (typeof people)[number]) => (p.state === "paid" ? 2 : p.isHost ? 0 : p.isMe ? 0.5 : 1);
  return people
    .sort((a, b) => rank(a) - rank(b) || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .map((p): TablePerson => ({ id: p.id, name: p.name, isMe: p.isMe, isHost: p.isHost, state: p.state }));
}

export type PersonLabels = { you: string; youSuffix: string; anotherGuest: string };

/** "Aarav (You)", "You", "Riya" or "Another guest"; never a stand-in name */
export function personLabel(p: Pick<TablePerson, "name" | "isMe">, l: PersonLabels): string {
  if (p.isMe) return p.name ? `${p.name} ${l.youSuffix}` : l.you;
  return p.name ?? l.anotherGuest;
}

/** Up to two letters for the avatar; null for a person without a name (shown with an icon) */
export function initials(name: string | null): string | null {
  if (!name) return null;
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0]?.toUpperCase() ?? "");
  return letters.join("") || null;
}

type OrderedLine = { orderId: string; unitPricePaise: number; qty: number; status: string };

const DEAD = new Set(["cancelled", "voided"]);
const IN_KITCHEN = new Set(["placed", "accepted", "preparing", "ready"]);

/**
 * Ordered so far: what was placed, at the price snapshotted when it was placed. Cancelled and
 * voided items do not count, and a round with nothing left in it is not a round. No tax, no split.
 */
export function orderedSoFar(lines: OrderedLine[]) {
  const live = lines.filter((l) => !DEAD.has(l.status));
  return {
    totalPaise: live.reduce((n, l) => n + l.unitPricePaise * l.qty, 0),
    items: live.reduce((n, l) => n + l.qty, 0),
    rounds: new Set(live.map((l) => l.orderId)).size,
    inKitchen: live.filter((l) => IN_KITCHEN.has(l.status)).reduce((n, l) => n + l.qty, 0),
  };
}
