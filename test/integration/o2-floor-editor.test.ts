import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getFloor } from "@/server/floor/read";
import { addDraftTable, addDraftZone, getOrCreateDraft, publishDraft, revokeOrReissueQr, updateDraftTable, updateDraftZone } from "@/server/floor/editor";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>; let owner: StaffSession; let host: StaffSession;
const fail = async (p: Promise<unknown>, code: AppError["code"]) => { const e = await p.then(() => null, (x) => x); expect(e).toBeInstanceOf(AppError); expect((e as AppError).code).toBe(code); };
beforeAll(async () => { env = await resetTestDb(); owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!; host = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000004", pin: "4444" })).token))!; });
afterAll(async () => { await env.conn.end(); });

describe("O2 versioned floor editor", () => {
  it("clones canonical data, isolates draft edits and rejects stale revisions", async () => {
    const before = await getFloor(host); const draft = await getOrCreateDraft(owner); expect(draft.version.status).toBe("draft");
    const table = draft.tables.find((t) => t.logicalTableId === env.demo.tableIds.T1)!;
    await updateDraftTable(owner, draft.version.id, table.id, { posX: table.posX + 3 }, draft.version.revision);
    const live = await getFloor(host); expect(live.tables.find((t) => t.id === env.demo.tableIds.T1)?.x).toBe(before.tables.find((t) => t.id === env.demo.tableIds.T1)?.x);
    await fail(updateDraftTable(owner, draft.version.id, table.id, { posX: 99 }, draft.version.revision), "conflict");
  });

  it("supports new zones/tables and publishes atomically into canonical rows", async () => {
    const draft = await getOrCreateDraft(owner); const rev = draft.version.revision; await addDraftZone(owner, draft.version.id, "O2 Verification", rev); const fresh = await getOrCreateDraft(owner); const z = fresh.zones.find((x) => x.name === "O2 Verification")!; await addDraftTable(owner, fresh.version.id, { code: "O2X", zoneId: z.id, maxSeats: 4 }, fresh.version.revision); const changed = await getOrCreateDraft(owner); expect(changed.tables.some((t) => t.code === "O2X")).toBe(true);
    await updateDraftZone(owner, changed.version.id, z.id, { width: 26, height: 16 }, changed.version.revision);
    const resized = await getOrCreateDraft(owner); const result = await publishDraft(owner, resized.version.id, resized.version.revision); expect(result.versionId).toBe(resized.version.id);
    const nextDraft = await getOrCreateDraft(owner); const carriedZone = nextDraft.zones.find((x) => x.name === "O2 Verification")!; expect(carriedZone.width).toBe(26); expect(carriedZone.height).toBe(16);
    const [table] = await env.db.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, owner.tenantId), eq(s.diningTables.outletId, owner.outletId), eq(s.diningTables.code, "O2X"))); expect(table.isActive).toBe(true); const [qr] = await env.db.select().from(s.qrCodes).where(and(eq(s.qrCodes.tenantId, owner.tenantId), eq(s.qrCodes.tableId, table.id), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt))); expect(qr).toBeTruthy();
  });

  it("allows immediate QR revoke/reissue without changing table identity and denies host", async () => {
    const [table] = await env.db.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, owner.tenantId), eq(s.diningTables.code, "T1"))); await fail(revokeOrReissueQr(host, table.id, true), "forbidden"); await revokeOrReissueQr(owner, table.id, true); const qrs = await env.db.select().from(s.qrCodes).where(and(eq(s.qrCodes.tenantId, owner.tenantId), eq(s.qrCodes.tableId, table.id), eq(s.qrCodes.type, "table"))); expect(qrs.filter((q) => !q.revokedAt)).toHaveLength(1); expect(table.id).toBe(env.demo.tableIds.T1);
  });

  it("stops at the restaurant's table limit and asks for an upgrade", async () => {
    const draft = await getOrCreateDraft(owner);
    const live = draft.tables.filter((t) => !t.archived).length;
    await env.db.update(s.tenants).set({ tableLimit: live }).where(eq(s.tenants.id, owner.tenantId));
    try {
      const fresh = await getOrCreateDraft(owner);
      expect(fresh.tableLimit).toBe(live);
      const zone = fresh.zones.find((z) => !z.archived)!;
      const err = await addDraftTable(owner, fresh.version.id, { code: "TX9", zoneId: zone.id, maxSeats: 4 }, fresh.version.revision).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).details?.reason).toBe("table_limit");
      expect((err as AppError).message).toContain(`includes ${live} tables`);
    } finally {
      await env.db.update(s.tenants).set({ tableLimit: null }).where(eq(s.tenants.id, owner.tenantId));
    }
  });
});
