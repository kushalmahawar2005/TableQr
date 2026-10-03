import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { StaffSession } from "../staff/auth";

export const floorEditorRoles = ["manager", "owner"] as const;
type Scope = Pick<StaffSession, "tenantId" | "outletId" | "userId" | "name" | "roles">;
const guard = (staff: Scope) => { if (!staff.roles.some((r) => floorEditorRoles.includes(r as never))) throw new AppError("forbidden", "Only a manager or owner can edit the floor plan."); };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const audit = async (tx: Tx, staff: Scope, action: string, entity: string, entityId: string | null, before?: unknown, after?: unknown) => {
  await tx.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action, entity, entityId, before, after, createdAt: new Date() });
};

async function nextVersion(staff: Scope) {
  const [row] = await db.select({ n: sql<number>`coalesce(max(${s.floorLayoutVersions.versionNumber}),0)` }).from(s.floorLayoutVersions).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.outletId, staff.outletId)));
  return Number(row?.n ?? 0) + 1;
}

/** Returns the single editable draft, cloning the canonical published floor lazily. */
export async function getOrCreateDraft(staff: Scope) {
  guard(staff);
  const existing = await db.select().from(s.floorLayoutVersions).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.outletId, staff.outletId), eq(s.floorLayoutVersions.status, "draft"))).limit(1);
  if (existing[0]) return loadDraft(staff, existing[0]);
  return db.transaction(async (tx) => {
    const again = await tx.select().from(s.floorLayoutVersions).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.outletId, staff.outletId), eq(s.floorLayoutVersions.status, "draft"))).limit(1);
    if (again[0]) return loadDraftTx(tx, staff, again[0]);
    const versionId = uuidv7();
    await tx.insert(s.floorLayoutVersions).values({ id: versionId, tenantId: staff.tenantId, outletId: staff.outletId, versionNumber: await nextVersion(staff), status: "draft", draftKey: "active", revision: 0, createdBy: staff.userId, createdAt: new Date(), updatedAt: new Date() });
    const zones = await tx.select().from(s.zones).where(and(eq(s.zones.tenantId, staff.tenantId), eq(s.zones.outletId, staff.outletId))).orderBy(asc(s.zones.sortOrder));
    const zoneMap = new Map<string, string>();
    for (const z of zones) {
      const id = uuidv7(); zoneMap.set(z.id, id);
      await tx.insert(s.floorLayoutZones).values({ id, tenantId: staff.tenantId, versionId, logicalZoneId: z.id, name: z.name, sortOrder: z.sortOrder, archived: !z.isActive, createdAt: new Date(), updatedAt: new Date() });
    }
    const tables = await tx.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId)));
    const tableMap = new Map<string, string>();
    for (const t of tables) { const draftId = uuidv7(); tableMap.set(t.id, draftId); await tx.insert(s.floorLayoutTables).values({ id: draftId, tenantId: staff.tenantId, versionId, logicalTableId: t.id, logicalZoneId: zoneMap.get(t.zoneId) ?? null, code: t.code, minSeats: t.minSeats, maxSeats: t.maxSeats, tableClass: t.tableClass, shape: t.shape, posX: t.posX, posY: t.posY, width: t.width, height: t.height, isBookableOnline: t.isBookableOnline, archived: !t.isActive, createdAt: new Date(), updatedAt: new Date() }); }
    for (const t of tables) for (const other of t.combinableWith ?? []) { const a = tableMap.get(t.id); const b = tableMap.get(other); if (a && b && a !== b) await tx.insert(s.floorLayoutCombinations).values({ id: uuidv7(), tenantId: staff.tenantId, versionId, tableId: a, combinedTableId: b, createdAt: new Date() }).onDuplicateKeyUpdate({ set: { createdAt: new Date() } }); }
    await audit(tx, staff, "floor.draft_created", "floor_layout_version", versionId, undefined, { versionNumber: await nextVersion(staff) });
    return loadDraftTx(tx, staff, (await tx.select().from(s.floorLayoutVersions).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.id, versionId))))[0]);
  });
}

async function loadDraft(staff: Scope, version: typeof s.floorLayoutVersions.$inferSelect) { return db.transaction((tx) => loadDraftTx(tx, staff, version)); }
async function loadDraftTx(tx: Tx, staff: Scope, version: typeof s.floorLayoutVersions.$inferSelect) {
  const [zones, tables, combinations] = await Promise.all([
    tx.select().from(s.floorLayoutZones).where(and(eq(s.floorLayoutZones.tenantId, staff.tenantId), eq(s.floorLayoutZones.versionId, version.id))).orderBy(asc(s.floorLayoutZones.sortOrder)),
    tx.select().from(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.versionId, version.id))).orderBy(asc(s.floorLayoutTables.code)),
    tx.select().from(s.floorLayoutCombinations).where(and(eq(s.floorLayoutCombinations.tenantId, staff.tenantId), eq(s.floorLayoutCombinations.versionId, version.id))),
  ]);
  return { version, zones, tables, combinations };
}

type TablePatch = Partial<Pick<typeof s.floorLayoutTables.$inferInsert, "code" | "minSeats" | "maxSeats" | "tableClass" | "shape" | "posX" | "posY" | "width" | "height" | "isBookableOnline" | "archived" | "logicalZoneId">>;
type ZonePatch = Partial<Pick<typeof s.floorLayoutZones.$inferInsert, "name" | "sortOrder" | "posX" | "posY" | "width" | "height" | "archived">>;

async function revise(staff: Scope, versionId: string, expectedRevision: number, work: (tx: Tx) => Promise<void>) {
  guard(staff);
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(s.floorLayoutVersions).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.outletId, staff.outletId), eq(s.floorLayoutVersions.id, versionId), eq(s.floorLayoutVersions.status, "draft"))).limit(1);
    if (!v) throw new AppError("not_found", "Draft floor plan not found.");
    if (v.revision !== expectedRevision) throw new AppError("conflict", "This floor draft changed in another window. Reload the latest draft.", { reason: "STALE_DRAFT", revision: v.revision });
    await work(tx);
    await tx.update(s.floorLayoutVersions).set({ revision: v.revision + 1, updatedAt: new Date() }).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.id, versionId), eq(s.floorLayoutVersions.revision, expectedRevision)));
    return v.revision + 1;
  });
}

export async function updateDraftTable(staff: Scope, versionId: string, tableId: string, patch: TablePatch, expectedRevision: number) {
  const next = { ...patch } as TablePatch;
  if (next.code != null) next.code = String(next.code).trim().toUpperCase();
  if (next.minSeats != null && next.maxSeats != null && (next.minSeats < 1 || next.maxSeats < next.minSeats)) throw new AppError("invalid_state", "Maximum seats must be at least minimum seats.");
  return revise(staff, versionId, expectedRevision, async (tx) => { const [old] = await tx.select().from(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.versionId, versionId), eq(s.floorLayoutTables.id, tableId))); if (!old) throw new AppError("not_found", "Draft table not found."); await tx.update(s.floorLayoutTables).set({ ...next, updatedAt: new Date() }).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.id, tableId))); await audit(tx, staff, next.code && next.code !== old.code ? "floor.table_code_changed" : "floor.table_updated", "floor_layout_table", tableId, old, next); });
}

export async function addDraftTable(staff: Scope, versionId: string, input: { code: string; zoneId: string; shape?: "square" | "round" | "long"; maxSeats: number }, expectedRevision: number) {
  return revise(staff, versionId, expectedRevision, async (tx) => { if (!input.code.trim() || input.maxSeats < 1) throw new AppError("invalid_state", "Enter a valid table code and capacity."); const [zone] = await tx.select().from(s.floorLayoutZones).where(and(eq(s.floorLayoutZones.tenantId, staff.tenantId), eq(s.floorLayoutZones.versionId, versionId), eq(s.floorLayoutZones.id, input.zoneId), eq(s.floorLayoutZones.archived, false))); if (!zone) throw new AppError("not_found", "Choose an active zone."); const [dup] = await tx.select({ id: s.floorLayoutTables.id }).from(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.versionId, versionId), eq(s.floorLayoutTables.code, input.code.trim().toUpperCase()))); if (dup) throw new AppError("conflict", "Table code already exists in this draft."); const id = uuidv7(); await tx.insert(s.floorLayoutTables).values({ id, tenantId: staff.tenantId, versionId, logicalZoneId: zone.id, code: input.code.trim().toUpperCase(), minSeats: 1, maxSeats: input.maxSeats, tableClass: `${input.maxSeats}-top`, shape: input.shape ?? "square", posX: 1, posY: 1, width: 2, height: 2, isBookableOnline: true, archived: false, createdAt: new Date(), updatedAt: new Date() }); await audit(tx, staff, "floor.table_created", "floor_layout_table", id, undefined, input); });
}

export async function addDraftZone(staff: Scope, versionId: string, name: string, expectedRevision: number) { return revise(staff, versionId, expectedRevision, async (tx) => { const id = uuidv7(); await tx.insert(s.floorLayoutZones).values({ id, tenantId: staff.tenantId, versionId, name: name.trim().slice(0, 60) || "New zone", sortOrder: 999, posX: 0, posY: 0, width: 12, height: 8, archived: false, createdAt: new Date(), updatedAt: new Date() }); await audit(tx, staff, "floor.zone_created", "floor_layout_zone", id, undefined, { name }); }); }
export async function updateDraftZone(staff: Scope, versionId: string, zoneId: string, patch: ZonePatch, expectedRevision: number) { return revise(staff, versionId, expectedRevision, async (tx) => { const [zone] = await tx.select().from(s.floorLayoutZones).where(and(eq(s.floorLayoutZones.tenantId, staff.tenantId), eq(s.floorLayoutZones.versionId, versionId), eq(s.floorLayoutZones.id, zoneId))); if (!zone) throw new AppError("not_found", "Draft zone not found."); if (patch.archived) { const [count] = await tx.select({ n: sql<number>`count(*)` }).from(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.versionId, versionId), eq(s.floorLayoutTables.logicalZoneId, zoneId), eq(s.floorLayoutTables.archived, false))); if (Number(count?.n ?? 0)) throw new AppError("conflict", "Move or archive assigned tables first."); } await tx.update(s.floorLayoutZones).set({ ...patch, updatedAt: new Date() }).where(and(eq(s.floorLayoutZones.tenantId, staff.tenantId), eq(s.floorLayoutZones.id, zoneId))); await audit(tx, staff, patch.archived ? "floor.zone_archived" : "floor.zone_updated", "floor_layout_zone", zoneId, zone, patch); }); }

export async function setCombination(staff: Scope, versionId: string, tableId: string, otherId: string, enabled: boolean, expectedRevision: number) { return revise(staff, versionId, expectedRevision, async (tx) => { if (tableId === otherId) throw new AppError("invalid_state", "A table cannot combine with itself."); const rows = await tx.select().from(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.versionId, versionId), inArray(s.floorLayoutTables.id, [tableId, otherId]), eq(s.floorLayoutTables.archived, false))); if (rows.length !== 2 || rows[0].logicalZoneId !== rows[1].logicalZoneId) throw new AppError("invalid_state", "Combinations must use active tables in the same zone."); const pairs = [[tableId, otherId], [otherId, tableId]] as const; for (const [a,b] of pairs) { await tx.delete(s.floorLayoutCombinations).where(and(eq(s.floorLayoutCombinations.tenantId, staff.tenantId), eq(s.floorLayoutCombinations.versionId, versionId), eq(s.floorLayoutCombinations.tableId, a), eq(s.floorLayoutCombinations.combinedTableId, b))); if (enabled) await tx.insert(s.floorLayoutCombinations).values({ id: uuidv7(), tenantId: staff.tenantId, versionId, tableId: a, combinedTableId: b, createdAt: new Date() }); } await audit(tx, staff, "floor.combination_changed", "floor_layout_table", tableId, undefined, { otherId, enabled }); }); }

export async function deleteDraftTable(staff: Scope, versionId: string, tableId: string, expectedRevision: number) {
  return revise(staff, versionId, expectedRevision, async (tx) => {
    const [table] = await tx.select().from(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.versionId, versionId), eq(s.floorLayoutTables.id, tableId)));
    if (!table) throw new AppError("not_found", "Draft table not found.");
    if (table.logicalTableId) await tx.update(s.floorLayoutTables).set({ archived: true, updatedAt: new Date() }).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.id, tableId)));
    else await tx.delete(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.id, tableId)));
    await audit(tx, staff, "floor.table_archived", "floor_layout_table", tableId, table, { archived: true });
  });
}

async function validateDraft(tx: Tx, staff: Scope, versionId: string) {
  const zones = await tx.select().from(s.floorLayoutZones).where(and(eq(s.floorLayoutZones.tenantId, staff.tenantId), eq(s.floorLayoutZones.versionId, versionId)));
  const tables = await tx.select().from(s.floorLayoutTables).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.versionId, versionId)));
  const activeZones = new Set(zones.filter((z) => !z.archived).map((z) => z.id)); const codes = new Set<string>();
  for (const t of tables) { if (t.archived) continue; if (codes.has(t.code)) throw new AppError("invalid_state", `Duplicate table code ${t.code}.`); codes.add(t.code); if (!activeZones.has(t.logicalZoneId ?? "")) throw new AppError("invalid_state", `Table ${t.code} has no active zone.`); if (t.minSeats < 1 || t.maxSeats < t.minSeats || t.width < 1 || t.height < 1 || t.posX < 0 || t.posY < 0 || t.posX + t.width > 120 || t.posY + t.height > 80) throw new AppError("invalid_state", `Table ${t.code} has invalid capacity or bounds.`); }
  return { zones, tables };
}

function joinCode() { return String(randomInt(1000, 10000)); }
function shortCode() { return Math.random().toString(36).slice(2, 10); }

export async function publishDraft(staff: Scope, versionId: string, expectedRevision: number) {
  guard(staff);
  const result = await db.transaction(async (tx) => {
    const [v] = await tx.select().from(s.floorLayoutVersions).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.outletId, staff.outletId), eq(s.floorLayoutVersions.id, versionId), eq(s.floorLayoutVersions.status, "draft"))).limit(1);
    if (!v || v.revision !== expectedRevision) throw new AppError("conflict", "This floor draft changed in another window. Reload the latest draft.", { reason: "STALE_DRAFT" });
    const { zones, tables } = await validateDraft(tx, staff, versionId);
    const oldPublished = await tx.select().from(s.floorLayoutVersions).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.outletId, staff.outletId), eq(s.floorLayoutVersions.status, "published"))).orderBy(desc(s.floorLayoutVersions.versionNumber)).limit(1);
    for (const z of zones.filter((x) => x.archived && x.logicalZoneId)) {
      const [future] = await tx.select({ id: s.reservations.id }).from(s.reservations).where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.outletId, staff.outletId), eq(s.reservations.requestedZoneId, z.logicalZoneId!), gte(s.reservations.startAt, new Date()), inArray(s.reservations.status, ["requested", "confirmed", "reminded", "arrived"]))).limit(1);
      if (future) throw new AppError("conflict", `Zone ${z.name} has a future reservation preference and cannot be archived.`);
    }
    for (const z of zones) {
      if (z.logicalZoneId) await tx.update(s.zones).set({ name: z.name, sortOrder: z.sortOrder, isActive: !z.archived }).where(and(eq(s.zones.tenantId, staff.tenantId), eq(s.zones.id, z.logicalZoneId), eq(s.zones.outletId, staff.outletId)));
      else { const id = uuidv7(); await tx.insert(s.zones).values({ id, tenantId: staff.tenantId, outletId: staff.outletId, name: z.name, sortOrder: z.sortOrder, isActive: !z.archived, createdAt: new Date() }); await tx.update(s.floorLayoutZones).set({ logicalZoneId: id }).where(and(eq(s.floorLayoutZones.tenantId, staff.tenantId), eq(s.floorLayoutZones.id, z.id))); }
    }
    const activeLogical = new Set(tables.filter((t) => !t.archived && t.logicalTableId).map((t) => t.logicalTableId!));
    const canon = await tx.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId)));
    const removed = canon.filter((c) => !activeLogical.has(c.id));
    for (const c of removed) {
      const active = await tx.select({ id: s.sessionTables.id }).from(s.sessionTables).innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId), ne(s.tableSessions.status, "closed"))).where(and(eq(s.sessionTables.tenantId, staff.tenantId), eq(s.sessionTables.tableId, c.id), isNotNull(s.sessionTables.activeKey))).limit(1);
      if (active.length) throw new AppError("conflict", `Table ${c.code} has an active session and cannot be archived.`);
      const future = await tx.select({ id: s.reservationTables.id }).from(s.reservationTables).innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId))).where(and(eq(s.reservationTables.tenantId, staff.tenantId), eq(s.reservationTables.tableId, c.id), gte(s.reservations.startAt, new Date()), inArray(s.reservations.status, ["requested", "confirmed", "reminded", "arrived"]))).limit(1);
      if (future.length) throw new AppError("conflict", `Table ${c.code} has a future reservation and cannot be archived.`);
      await tx.update(s.diningTables).set({ isActive: false }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, c.id)));
    }
    for (const t of tables) {
      if (t.archived) { if (t.logicalTableId) await tx.update(s.diningTables).set({ isActive: false }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, t.logicalTableId))); continue; }
      const [zone] = await tx.select({ id: s.floorLayoutZones.logicalZoneId }).from(s.floorLayoutZones).where(and(eq(s.floorLayoutZones.tenantId, staff.tenantId), eq(s.floorLayoutZones.id, t.logicalZoneId!)));
      if (!zone?.id) throw new AppError("invalid_state", "Every table must belong to a published zone.");
      if (t.logicalTableId) {
        const [old] = await tx.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, t.logicalTableId)));
        if (old && t.maxSeats < old.maxSeats) {
          const [active] = await tx.select({ partySize: s.tableSessions.partySize }).from(s.sessionTables).innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId), ne(s.tableSessions.status, "closed"))).where(and(eq(s.sessionTables.tenantId, staff.tenantId), eq(s.sessionTables.tableId, t.logicalTableId), isNotNull(s.sessionTables.activeKey))).limit(1);
          if (active?.partySize && active.partySize > t.maxSeats) throw new AppError("conflict", `Table ${old.code} cannot be reduced below its seated party.`);
          const [future] = await tx.select({ partySize: s.reservations.partySize }).from(s.reservationTables).innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId))).where(and(eq(s.reservationTables.tenantId, staff.tenantId), eq(s.reservationTables.tableId, t.logicalTableId), gte(s.reservations.startAt, new Date()), inArray(s.reservations.status, ["requested", "confirmed", "reminded", "arrived"]))).limit(1);
          if (future?.partySize && future.partySize > t.maxSeats) throw new AppError("conflict", `Table ${old.code} cannot be reduced below its future reservation.`);
        }
        if (old && old.code !== t.code) {
          const active = await tx.select({ id: s.sessionTables.id }).from(s.sessionTables).where(and(eq(s.sessionTables.tenantId, staff.tenantId), eq(s.sessionTables.tableId, t.logicalTableId), isNotNull(s.sessionTables.activeKey))).limit(1);
          if (active.length) throw new AppError("conflict", `Table ${old.code} has an active session and cannot be renamed.`);
        }
        await tx.update(s.diningTables).set({ zoneId: zone.id, code: t.code, minSeats: t.minSeats, maxSeats: t.maxSeats, tableClass: t.tableClass, shape: t.shape, posX: t.posX, posY: t.posY, width: t.width, height: t.height, isBookableOnline: t.isBookableOnline, isActive: true }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, t.logicalTableId)));
      }
      else { const id = uuidv7(); await tx.insert(s.diningTables).values({ id, tenantId: staff.tenantId, outletId: staff.outletId, zoneId: zone.id, code: t.code, minSeats: t.minSeats, maxSeats: t.maxSeats, tableClass: t.tableClass, shape: t.shape, posX: t.posX, posY: t.posY, width: t.width, height: t.height, isBookableOnline: t.isBookableOnline, isActive: true, joinCode: joinCode(), state: "available", createdAt: new Date(), updatedAt: new Date() }); await tx.update(s.floorLayoutTables).set({ logicalTableId: id }).where(and(eq(s.floorLayoutTables.tenantId, staff.tenantId), eq(s.floorLayoutTables.id, t.id))); }
    }
    const draftPairs = await tx.select().from(s.floorLayoutCombinations).where(and(eq(s.floorLayoutCombinations.tenantId, staff.tenantId), eq(s.floorLayoutCombinations.versionId, versionId)));
    const byDraft = new Map(tables.map((t) => [t.id, t.logicalTableId]));
    const combined = new Map<string, string[]>();
    for (const pair of draftPairs) { const a = byDraft.get(pair.tableId); const b = byDraft.get(pair.combinedTableId); if (a && b) combined.set(a, [...(combined.get(a) ?? []), b]); }
    const currentCanon = await tx.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId)));
    for (const c of currentCanon) for (const oldOther of c.combinableWith ?? []) if (!(combined.get(c.id) ?? []).includes(oldOther)) {
      const activePair = await tx.select({ id: s.sessionTables.id }).from(s.sessionTables).innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId), ne(s.tableSessions.status, "closed"))).where(and(eq(s.sessionTables.tenantId, staff.tenantId), eq(s.sessionTables.tableId, c.id), isNotNull(s.sessionTables.activeKey))).limit(1);
      const activeOther = await tx.select({ id: s.sessionTables.id }).from(s.sessionTables).innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId), ne(s.tableSessions.status, "closed"))).where(and(eq(s.sessionTables.tenantId, staff.tenantId), eq(s.sessionTables.tableId, oldOther), isNotNull(s.sessionTables.activeKey))).limit(1);
      if (activePair.length && activeOther.length) throw new AppError("conflict", `Combination ${c.code} cannot be removed while in use.`);
      const reservationsUsing = await tx.select({ id: s.reservationTables.reservationId }).from(s.reservationTables).innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId))).where(and(eq(s.reservationTables.tenantId, staff.tenantId), inArray(s.reservationTables.tableId, [c.id, oldOther]), gte(s.reservations.startAt, new Date()), inArray(s.reservations.status, ["requested", "confirmed", "reminded", "arrived"]))).groupBy(s.reservationTables.reservationId).having(sql`count(*) = 2`).limit(1);
      if (reservationsUsing.length) throw new AppError("conflict", `Combination ${c.code} cannot be removed while reserved.`);
    }
    for (const c of currentCanon) if (c.isActive) await tx.update(s.diningTables).set({ combinableWith: combined.get(c.id) ?? [] }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, c.id)));
    for (const c of currentCanon) if (c.isActive) {
      const [qr] = await tx.select({ id: s.qrCodes.id }).from(s.qrCodes).where(and(eq(s.qrCodes.tenantId, staff.tenantId), eq(s.qrCodes.outletId, staff.outletId), eq(s.qrCodes.tableId, c.id), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt))).limit(1);
      if (!qr) await tx.insert(s.qrCodes).values({ id: uuidv7(), tenantId: staff.tenantId, outletId: staff.outletId, tableId: c.id, type: "table", shortCode: shortCode(), createdAt: new Date() });
    } else await tx.update(s.qrCodes).set({ revokedAt: new Date() }).where(and(eq(s.qrCodes.tenantId, staff.tenantId), eq(s.qrCodes.tableId, c.id), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt)));
    await tx.update(s.floorLayoutVersions).set({ status: "archived", draftKey: null }).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.outletId, staff.outletId), eq(s.floorLayoutVersions.status, "published")));
    await tx.update(s.floorLayoutVersions).set({ status: "published", draftKey: null, publishedBy: staff.userId, publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(s.floorLayoutVersions.tenantId, staff.tenantId), eq(s.floorLayoutVersions.id, versionId)));
    await audit(tx, staff, "floor.layout_published", "floor_layout_version", versionId, oldPublished[0] ?? null, { revision: expectedRevision });
    return { versionId, versionNumber: v.versionNumber };
  });
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.menu, type: "floor.layout_published", data: result }]);
  return result;
}

export async function revokeOrReissueQr(staff: Scope, tableId: string, reissue: boolean) {
  guard(staff);
  return db.transaction(async (tx) => {
    const [table] = await tx.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.id, tableId), eq(s.diningTables.isActive, true)));
    if (!table) throw new AppError("not_found", "Published table not found.");
    await tx.update(s.qrCodes).set({ revokedAt: new Date() }).where(and(eq(s.qrCodes.tenantId, staff.tenantId), eq(s.qrCodes.outletId, staff.outletId), eq(s.qrCodes.tableId, tableId), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt)));
    if (!reissue) { await audit(tx, staff, "floor.qr_revoked", "dining_table", tableId, undefined, { revoked: true }); return null; }
    const code = shortCode(); await tx.update(s.diningTables).set({ joinCode: joinCode() }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, tableId)));
    const [row] = await tx.insert(s.qrCodes).values({ tenantId: staff.tenantId, outletId: staff.outletId, tableId, type: "table", shortCode: code, createdAt: new Date() }).$returningId();
    await audit(tx, staff, "floor.qr_reissued", "dining_table", tableId, undefined, { shortCode: code }); return row.id;
  });
}

export async function getPublishedQr(staff: Scope, tableId: string) { guard(staff); const [row] = await db.select({ qr: s.qrCodes, table: s.diningTables, outlet: s.outlets }).from(s.qrCodes).innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.qrCodes.tenantId), eq(s.diningTables.id, s.qrCodes.tableId))).innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.qrCodes.tenantId), eq(s.outlets.id, s.qrCodes.outletId))).where(and(eq(s.qrCodes.tenantId, staff.tenantId), eq(s.qrCodes.outletId, staff.outletId), eq(s.qrCodes.tableId, tableId), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt), eq(s.diningTables.isActive, true))).orderBy(desc(s.qrCodes.createdAt)).limit(1); if (!row) throw new AppError("not_found", "No active QR exists for this table."); return row; }
