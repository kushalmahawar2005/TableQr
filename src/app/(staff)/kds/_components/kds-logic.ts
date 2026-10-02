import { ticketUrgency, urgencyRank, type Urgency } from "@/domain/kitchen";
import type { KitchenCard } from "@/server/kitchen/display";

// Pure helpers for the kitchen screen: the clock ticks locally between server loads, so
// elapsed time and urgency are recomputed here from the same rule the server uses.

/** A card as the screen shows it; awaitingStaff is a read-only state the screen can render */
export type KdsCard = KitchenCard & { awaitingStaff?: boolean };

/** Elapsed since the order was placed, and urgency from the ticket's target */
export function liveCard(card: KdsCard, now: number): KdsCard {
  const elapsedMs = Math.max(0, now - card.placedAt);
  return { ...card, elapsedMs, urgency: ticketUrgency(elapsedMs, card.targetMinutes, card.stage !== "placed") };
}

/** Most urgent first; inside the same urgency, the oldest */
export function sortCards(cards: KdsCard[]): KdsCard[] {
  return [...cards].sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency) || a.placedAt - b.placedAt);
}

/** 7:05, 12:40, 1:02:05 */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A card is "NEW" for its first three minutes until a cook starts it */
export const NEW_FOR_MS = 3 * 60_000;
export const isFresh = (card: KdsCard) => card.stage !== "preparing" && card.elapsedMs < NEW_FOR_MS;

/**
 * Decides which tickets deserve a sound. The first load only primes (nothing already on screen
 * beeps); after that each ticket chimes once when it arrives and once when it turns late, no
 * matter how many polls, re-renders or reconnects follow. Ids already announced on this device
 * (e.g. before a reload) never chime again.
 */
export function createAnnouncer(remembered: { arrived?: string[]; late?: string[] } = {}) {
  const arrived = new Set(remembered.arrived ?? []);
  const late = new Set(remembered.late ?? []);
  let primed = false;
  return {
    next(cards: Pick<KdsCard, "ticketId" | "urgency">[]): { arrived: string[]; late: string[] } {
      const fresh: string[] = [];
      const turned: string[] = [];
      for (const c of cards) {
        if (!arrived.has(c.ticketId)) {
          arrived.add(c.ticketId);
          if (primed) fresh.push(c.ticketId);
        }
        if (c.urgency === "late" && !late.has(c.ticketId)) {
          late.add(c.ticketId);
          if (primed) turned.push(c.ticketId);
        }
      }
      primed = true;
      return { arrived: fresh, late: turned };
    },
    /** Take these in silently, e.g. after switching the station tab */
    prime(cards: Pick<KdsCard, "ticketId" | "urgency">[]) {
      for (const c of cards) {
        arrived.add(c.ticketId);
        if (c.urgency === "late") late.add(c.ticketId);
      }
      primed = true;
    },
    /** What to remember across reloads (bounded) */
    snapshot() {
      return { arrived: [...arrived].slice(-300), late: [...late].slice(-300) };
    },
  };
}

export type Announcer = ReturnType<typeof createAnnouncer>;

export type Connection = "live" | "connecting" | "reconnecting" | "polling" | "offline";

export type { Urgency };
