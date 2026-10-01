import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { parseAllergens, parseSpice } from "@/domain/allergens";
import { isPlaceholderName } from "@/domain/guest-name";
import { primaryTag } from "@/domain/menu-price";
import { AppError } from "../errors";
import { isWithinCategoryWindow, loadItems } from "./menu";
import { guestContextForDevice } from "./menu-screen";

// Everything the G4 item sheet shows for one dish, for a guest at this table.

export async function getItemSheet(outletCode: string, shortCode: string, deviceId: string | null, itemId: string, now = new Date()) {
  const { t, open, ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
  const [loaded] = await loadItems(db, ctx, now, [itemId]);
  if (!loaded) throw new AppError("not_found", "This dish is not on the menu.");
  const { item, pricing } = loaded;

  const mine = await db
    .select({ qty: s.cartLines.qty, modifiers: s.cartLines.modifiers, note: s.cartLines.note, sharedWith: s.cartLines.sharedWith })
    .from(s.cartLines)
    .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.participantId, ctx.participantId), eq(s.cartLines.itemId, itemId)));
  const plainQty = mine.filter((l) => !l.modifiers?.length && !l.note && !l.sharedWith?.length).reduce((n, l) => n + l.qty, 0);

  const host = open.people.find((p) => p.id === open.session.hostParticipantId);
  return {
    outlet: { code: t.outlet.code, accentColor: t.outlet.accentColor },
    session: {
      key: open.session.id,
      status: open.session.status,
      orderingLocked: open.session.orderingLocked,
      hostName: host && !isPlaceholderName(host.displayName) ? host.displayName : null,
    },
    item: {
      id: item.id,
      nameEn: item.nameEn,
      nameHi: item.nameHi,
      descriptionEn: item.descriptionEn,
      descriptionHi: item.descriptionHi,
      pricePaise: pricing.pricePaise,
      isVeg: item.isVeg,
      isJain: item.isJain,
      spice: parseSpice(item.spiceLevel),
      allergens: parseAllergens(item.allergens),
      tag: primaryTag(item.tags),
      imageUrl: item.imageUrl,
      available: pricing.isAvailable,
      /** Outside its category's hours (breakfast in the evening) */
      outsideHours: !isWithinCategoryWindow(loaded.categoryWindow, ctx.timezone, now),
    },
    groups: pricing.groups.map((g) => ({
      id: g.id,
      nameEn: g.nameEn,
      nameHi: g.nameHi ?? null,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: g.modifiers,
    })),
    plainQty,
  };
}

export type ItemSheetData = Awaited<ReturnType<typeof getItemSheet>>;
