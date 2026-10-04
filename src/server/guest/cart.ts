import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { cleanNote, lineKey } from "@/domain/item-sheet";
import { optionsKind } from "@/domain/menu-price";
import { MAX_QTY, priceLine, quoteKey, type PriceQuote } from "@/domain/pricing";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { GuestContext } from "./context";
import { isWithinCategoryWindow, loadItems, type MenuItem } from "./menu";

/** Breakfast after breakfast hours cannot be added, not only refused at Place order */
function assertInHours(ctx: GuestContext, loaded: MenuItem, now: Date) {
  if (!isWithinCategoryWindow(loaded.categoryWindow, ctx.timezone, now)) {
    throw new AppError("items_unavailable", `${loaded.item.nameEn} is not available right now.`, {
      itemIds: [loaded.item.id],
      reason: "outside_hours",
    });
  }
}

// Per-person cart inside the table session (PS 3.5). The phone sends ids and quantities only.

async function sessionParticipantIds(ctx: GuestContext) {
  const rows = await db
    .select({ id: s.participants.id })
    .from(s.participants)
    .where(
      and(
        eq(s.participants.tenantId, ctx.tenantId),
        eq(s.participants.sessionId, ctx.sessionId),
        isNull(s.participants.removedAt),
        // Paid and left: later orders exclude them, shared items included (PS 3.6)
        isNull(s.participants.paidOutAt),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Carts can change only while the table is ordering: not after the bill is requested, not while
 * the host has paused ordering, never on a closed table. Browsing and viewing stay open.
 */
export async function assertCartEditable(ctx: GuestContext) {
  const [session] = await db
    .select({ status: s.tableSessions.status, locked: s.tableSessions.orderingLocked, hostId: s.tableSessions.hostParticipantId })
    .from(s.tableSessions)
    .where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, ctx.sessionId)));
  if (!session || session.status === "closed") {
    throw new AppError("session_expired", "Your table session has ended. Scan the table QR again to continue.");
  }
  if (session.status === "bill_requested") {
    throw new AppError("table_settling", "The bill has been requested, so new orders are paused.");
  }
  if (session.locked) throw new AppError("ordering_locked", "Ordering is paused by the host.");
}

/** A plain line: the dish as it comes, no options, no note, not shared. G3's Add and stepper edit only these. */
const isPlainLine = (l: typeof s.cartLines.$inferSelect) => !l.modifiers?.length && !l.note && !l.sharedWith?.length;

/**
 * Sets how many of a dish this guest has as a plain line (G3 stepper). Absolute, so repeated or
 * late requests land on the same result. 0 removes it. Lines with options, notes or sharing are
 * left alone; they are edited in the cart.
 */
export async function setPlainItemQty(ctx: GuestContext, itemId: string, qty: number, now = new Date()) {
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) {
    throw new AppError("invalid_line", `Choose a quantity between 0 and ${MAX_QTY}.`);
  }
  await assertCartEditable(ctx);

  const mine = await db
    .select()
    .from(s.cartLines)
    .where(
      and(
        eq(s.cartLines.tenantId, ctx.tenantId),
        eq(s.cartLines.participantId, ctx.participantId),
        eq(s.cartLines.itemId, itemId),
      ),
    )
    .orderBy(asc(s.cartLines.id));
  const plain = mine.filter(isPlainLine);
  const current = plain.reduce((n, l) => n + l.qty, 0);

  if (qty > current) {
    const [loaded] = await loadItems(db, ctx, now, [itemId]);
    if (!loaded) throw new AppError("invalid_line", "This dish is not on the menu.");
    assertInHours(ctx, loaded, now);
    if (optionsKind(loaded.pricing.groups) === "required") {
      throw new AppError("needs_choice", `${loaded.item.nameEn} needs a choice before it can be added.`);
    }
    const priced = priceLine(loaded.pricing, qty, []);
    if (!priced.ok) {
      if (priced.error.code === "item_unavailable") {
        throw new AppError("items_unavailable", `${loaded.item.nameEn} just sold out.`, { itemIds: [itemId] });
      }
      throw new AppError("invalid_line", describeLineError(priced.error), { error: priced.error });
    }
  }

  const [keep, ...extra] = plain;
  await db.transaction(async (tx) => {
    // Older duplicates collapse into one line
    const drop = qty === 0 ? plain : extra;
    if (drop.length) {
      await tx
        .delete(s.cartLines)
        .where(
          and(
            eq(s.cartLines.tenantId, ctx.tenantId),
            eq(s.cartLines.participantId, ctx.participantId),
            inArray(s.cartLines.id, drop.map((l) => l.id)),
          ),
        );
    }
    if (qty === 0) return;
    if (keep) {
      await tx
        .update(s.cartLines)
        .set({ qty })
        .where(
          and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.participantId, ctx.participantId), eq(s.cartLines.id, keep.id)),
        );
    } else {
      await tx.insert(s.cartLines).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        sessionId: ctx.sessionId,
        participantId: ctx.participantId,
        itemId,
        qty,
      });
    }
  });
  if (qty !== current || extra.length) void publish(ctx, [cartUpdated(ctx)]);
  return { qty };
}

/**
 * G4 "Add to cart". A plain dish (no options, no note) raises the plain line the menu stepper
 * edits. A configured dish joins an existing line of mine only when the dish, the option set and
 * the note are exactly the same; otherwise it becomes a new line. Nothing else is touched.
 */
export async function addConfiguredLine(
  ctx: GuestContext,
  input: { itemId: string; qty: number; modifierIds?: string[]; note?: string },
  now = new Date(),
) {
  const modifierIds = [...new Set(input.modifierIds ?? [])];
  const note = cleanNote(input.note);
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > MAX_QTY) {
    throw new AppError("invalid_line", `Choose a quantity between 1 and ${MAX_QTY}.`);
  }
  await assertCartEditable(ctx);
  const [loaded] = await loadItems(db, ctx, now, [input.itemId]);
  if (!loaded) throw new AppError("invalid_line", "This dish is not on the menu.");
  assertInHours(ctx, loaded, now);

  const priced = priceLine(loaded.pricing, input.qty, modifierIds);
  if (!priced.ok) {
    if (priced.error.code === "item_unavailable") {
      throw new AppError("items_unavailable", `${loaded.item.nameEn} just sold out.`, { itemIds: [input.itemId] });
    }
    if (priced.error.code === "modifier_unavailable") {
      throw new AppError("invalid_line", "One of your choices just became unavailable.", { modifierIds: [priced.error.modifierId] });
    }
    throw new AppError("invalid_line", describeLineError(priced.error), { error: priced.error });
  }

  const mine = await db
    .select()
    .from(s.cartLines)
    .where(
      and(
        eq(s.cartLines.tenantId, ctx.tenantId),
        eq(s.cartLines.participantId, ctx.participantId),
        eq(s.cartLines.itemId, input.itemId),
      ),
    )
    .orderBy(asc(s.cartLines.id));

  const tooMany = () => new AppError("invalid_line", `You can have up to ${MAX_QTY} of this dish.`, { reason: "max_qty" });

  if (modifierIds.length === 0 && !note) {
    const current = mine.filter(isPlainLine).reduce((n, l) => n + l.qty, 0);
    if (current + input.qty > MAX_QTY) throw tooMany();
    await setPlainItemQty(ctx, input.itemId, current + input.qty, now);
    return { merged: current > 0 };
  }

  const key = lineKey(input.itemId, modifierIds, note);
  const same = mine.find(
    (l) => !l.sharedWith?.length && lineKey(l.itemId, (l.modifiers ?? []).map((m) => m.modifierId), l.note) === key,
  );
  if (same) {
    if (same.qty + input.qty > MAX_QTY) throw tooMany();
    await db
      .update(s.cartLines)
      .set({ qty: same.qty + input.qty })
      .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.participantId, ctx.participantId), eq(s.cartLines.id, same.id)));
  } else {
    await db.insert(s.cartLines).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      participantId: ctx.participantId,
      itemId: input.itemId,
      qty: input.qty,
      modifiers: priced.line.modifiers.map((m) => ({ groupId: m.groupId, modifierId: m.modifierId })),
      note: note || null,
    });
  }
  void publish(ctx, [cartUpdated(ctx)]);
  return { merged: !!same };
}

export async function addCartLine(
  ctx: GuestContext,
  input: { itemId: string; qty: number; modifierIds?: string[]; note?: string; sharedWith?: string[] },
  now = new Date(),
) {
  await assertCartEditable(ctx);
  const [loaded] = await loadItems(db, ctx, now, [input.itemId]);
  if (!loaded) throw new AppError("invalid_line", "This dish is not on the menu.");
  assertInHours(ctx, loaded, now);

  const modifierIds = input.modifierIds ?? [];
  const priced = priceLine(loaded.pricing, input.qty, modifierIds);
  if (!priced.ok) {
    if (priced.error.code === "item_unavailable") {
      throw new AppError("items_unavailable", `${loaded.item.nameEn} just sold out.`, { itemIds: [input.itemId] });
    }
    throw new AppError("invalid_line", describeLineError(priced.error), { error: priced.error });
  }

  let sharedWith: string[] | null = null;
  if (input.sharedWith?.length) {
    const present = new Set(await sessionParticipantIds(ctx));
    sharedWith = [...new Set(input.sharedWith)];
    if (sharedWith.some((id) => !present.has(id))) {
      throw new AppError("invalid_line", "Someone you picked to share with is no longer at the table.");
    }
    if (sharedWith.length === 1 && sharedWith[0] === ctx.participantId) sharedWith = null;
  }

  const id = uuidv7();
  await db.insert(s.cartLines).values({
    id,
    tenantId: ctx.tenantId,
    sessionId: ctx.sessionId,
    participantId: ctx.participantId,
    itemId: input.itemId,
    qty: input.qty,
    modifiers: priced.line.modifiers.map((m) => ({ groupId: m.groupId, modifierId: m.modifierId })),
    note: input.note?.trim().slice(0, 140) || null,
    sharedWith,
  });
  void publish(ctx, [cartUpdated(ctx)]);
  return { id, unitPricePaise: priced.line.unitPricePaise, linePaise: priced.line.linePaise };
}

/** The whole-table cart view (G5) changes for everyone when anyone edits their cart */
const cartUpdated = (ctx: GuestContext) => ({ topic: topics.session(ctx.sessionId), type: "cart.updated" });

/** Sets the quantity of one of your own lines; 0 removes it */
export async function setCartLineQty(ctx: GuestContext, lineId: string, qty: number) {
  await assertCartEditable(ctx);
  if (qty <= 0) {
    await db
      .delete(s.cartLines)
      .where(
        and(
          eq(s.cartLines.tenantId, ctx.tenantId),
          eq(s.cartLines.participantId, ctx.participantId),
          eq(s.cartLines.id, lineId),
        ),
      );
    void publish(ctx, [cartUpdated(ctx)]);
    return;
  }
  if (!Number.isInteger(qty) || qty > MAX_QTY) throw new AppError("invalid_line", `Choose a quantity between 1 and ${MAX_QTY}.`);
  await db
    .update(s.cartLines)
    .set({ qty })
    .where(
      and(
        eq(s.cartLines.tenantId, ctx.tenantId),
        eq(s.cartLines.participantId, ctx.participantId),
        eq(s.cartLines.id, lineId),
      ),
    );
  void publish(ctx, [cartUpdated(ctx)]);
}

export type LineBlock = "sold_out" | "outside_hours" | "option_unavailable";

/** "Mine" and "Whole table" views of the cart (G5), priced live on the server */
export async function getCart(ctx: GuestContext, now = new Date()) {
  const lines = await db
    .select({ line: s.cartLines, ownerName: s.participants.displayName })
    .from(s.cartLines)
    .innerJoin(s.participants, eq(s.participants.id, s.cartLines.participantId))
    .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.sessionId, ctx.sessionId)))
    .orderBy(asc(s.cartLines.id));

  const items = await loadItems(db, ctx, now, [...new Set(lines.map((l) => l.line.itemId))]);
  const byId = new Map(items.map((i) => [i.item.id, i]));

  const priced = lines.map(({ line, ownerName }) => {
    const loaded = byId.get(line.itemId);
    const res = loaded ? priceLine(loaded.pricing, line.qty, (line.modifiers ?? []).map((m) => m.modifierId)) : null;
    // Why a line cannot be placed right now (G5 shows it and blocks Place order until removed)
    const reason: LineBlock | null = !loaded
      ? "sold_out"
      : !isWithinCategoryWindow(loaded.categoryWindow, ctx.timezone, now)
        ? "outside_hours"
        : res?.ok
          ? null
          : res?.error.code === "item_unavailable"
            ? "sold_out"
            : "option_unavailable";
    return {
      id: line.id,
      itemId: line.itemId,
      nameEn: loaded?.item.nameEn ?? "Unavailable item",
      nameHi: loaded?.item.nameHi ?? null,
      isVeg: loaded?.item.isVeg ?? true,
      qty: line.qty,
      note: line.note,
      sharedWith: line.sharedWith ?? [],
      ownerId: line.participantId,
      ownerName,
      isMine: line.participantId === ctx.participantId,
      modifiers: res?.ok ? res.line.modifiers.map((m) => ({ nameEn: m.nameEn, nameHi: m.nameHi })) : [],
      unitPricePaise: res?.ok ? res.line.unitPricePaise : null,
      linePaise: res?.ok ? res.line.linePaise : null,
      quoteKey: quoteKey(line.itemId, (line.modifiers ?? []).map((m) => m.modifierId)),
      isAvailable: reason === null,
      reason,
      /** Plain: the dish as it comes; configured: options or a note */
      kind: !line.modifiers?.length && !line.note ? ("plain" as const) : ("configured" as const),
    };
  });

  const mine = priced.filter((l) => l.isMine);
  // The unit prices shown for my placeable lines; Place order sends them back for comparison
  const quote: PriceQuote = {};
  for (const l of mine) if (!l.reason && l.unitPricePaise !== null) quote[l.quoteKey] = l.unitPricePaise;
  return {
    mine,
    table: priced,
    quote,
    // Only lines that can be placed now count
    mySubtotalPaise: mine.reduce((sum, l) => sum + (l.reason ? 0 : (l.linePaise ?? 0)), 0),
  };
}

/**
 * Removes one of my lines and returns what it was, so G5's Undo can add it again. The snapshot
 * holds the configuration only; restoring goes through addCartLine, which checks availability,
 * options and hours again and prices it at today's menu price.
 */
export async function removeCartLine(ctx: GuestContext, lineId: string) {
  await assertCartEditable(ctx);
  const [line] = await db
    .select()
    .from(s.cartLines)
    .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.participantId, ctx.participantId), eq(s.cartLines.id, lineId)));
  if (!line) return null;
  await setCartLineQty(ctx, lineId, 0);
  return {
    itemId: line.itemId,
    qty: line.qty,
    modifierIds: (line.modifiers ?? []).map((m) => m.modifierId),
    note: line.note ?? undefined,
    sharedWith: line.sharedWith ?? undefined,
  };
}

export type RemovedLine = NonNullable<Awaited<ReturnType<typeof removeCartLine>>>;

export async function clearCartLines(ctx: GuestContext, lineIds: string[]) {
  if (lineIds.length === 0) return;
  await db
    .delete(s.cartLines)
    .where(
      and(
        eq(s.cartLines.tenantId, ctx.tenantId),
        eq(s.cartLines.participantId, ctx.participantId),
        inArray(s.cartLines.id, lineIds),
      ),
    );
}

export function describeLineError(e: Exclude<ReturnType<typeof priceLine>, { ok: true }>["error"]): string {
  switch (e.code) {
    case "too_few":
      return `Choose ${e.min === 1 ? "one option" : `at least ${e.min} options`} for ${e.groupName}.`;
    case "too_many":
      return `Choose up to ${e.max} for ${e.groupName}.`;
    case "bad_quantity":
      return "Choose a quantity between 1 and 50.";
    case "modifier_unavailable":
      return "One of the options you picked is no longer available.";
    case "item_unavailable":
      return "This dish just sold out.";
    default:
      return "Something about this dish changed. Please pick your options again.";
  }
}
