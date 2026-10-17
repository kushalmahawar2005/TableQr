import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { ensureSchema } from "@/server/ensure-schema";
import { resetTestDb } from "./setup-db";

// The live database is brought up to date at server start (Hostinger never runs db:migrate).
// Here the test database is put back to how production looked before this release.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const rows = async <T,>(q: ReturnType<typeof sql>) => (await env.db.execute(q))[0] as unknown as T[];
const columns = async () =>
  (await rows<{ c: string }>(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME IN ('kitchen_display', 'table_limit', 'custom_features', 'custom_price_paise')`)).map((r) => r.c).sort();

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("schema update at startup", () => {
  it("adds what is missing, fills the defaults, records the migrations, and does nothing the second time", async () => {
    await env.db.execute(sql`ALTER TABLE tenants DROP COLUMN kitchen_display, DROP COLUMN table_limit, DROP COLUMN custom_features, DROP COLUMN custom_price_paise`);
    await env.db.execute(sql`ALTER TABLE users DROP COLUMN duty_status, DROP COLUMN duty_changed_at, DROP COLUMN last_seen_at`);
    await env.db.execute(sql`DELETE FROM plans WHERE code = 'custom'`);
    await env.db.execute(sql`UPDATE plans SET features = JSON_REMOVE(features, '$.kitchenDisplay', '$.waiterApp', '$.discounts', '$.whatsappBills', '$.reservations', '$.fullReports')`);
    await env.db.execute(sql`DELETE FROM __drizzle_migrations WHERE created_at > 1791043208000`);
    expect(await columns()).toEqual([]);

    await ensureSchema(appDb.$client);
    expect(await columns()).toEqual(["custom_features", "custom_price_paise", "kitchen_display", "table_limit"]);
    const plans = await rows<{ code: string; kds: string }>(sql`SELECT code, JSON_EXTRACT(features, '$.kitchenDisplay') AS kds FROM plans ORDER BY sort_order`);
    expect(Object.fromEntries(plans.map((p) => [p.code, String(p.kds)]))).toEqual({ starter: "false", growth: "false", pro: "true", chain: "true", custom: "false" });
    // The new switches: Starter gets none, Growth all but full reports, higher plans everything
    const switches = await rows<{ code: string; w: string; r: string }>(sql`SELECT code, JSON_EXTRACT(features, '$.waiterApp') AS w, JSON_EXTRACT(features, '$.fullReports') AS r FROM plans ORDER BY sort_order`);
    expect(switches.map((p) => `${p.code}:${p.w}/${p.r}`)).toEqual(["starter:false/false", "growth:true/false", "pro:true/true", "chain:true/true", "custom:false/false"]);
    // Existing restaurants keep the tables they run today as their limit
    const limits = await rows<{ n: number; lim: number }>(sql`SELECT t.table_limit AS lim, (SELECT COUNT(*) FROM dining_tables d WHERE d.tenant_id = t.id AND d.is_active = 1) AS n FROM tenants t`);
    for (const l of limits) expect(Number(l.lim)).toBe(Math.max(1, Number(l.n)));
    const recorded = await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE created_at > 1791043208000`);
    expect(Number(recorded[0].n)).toBe(5);
    // Staff start on duty
    expect((await rows<{ s: string }>(sql`SELECT DISTINCT duty_status AS s FROM users`)).map((r) => r.s)).toEqual(["on"]);

    // Second start: nothing changes, nothing is recorded twice
    await env.db.execute(sql`UPDATE tenants SET table_limit = 99`);
    await ensureSchema(appDb.$client);
    expect(Number((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE created_at > 1791043208000`))[0].n)).toBe(5);
    expect((await rows<{ lim: number }>(sql`SELECT DISTINCT table_limit AS lim FROM tenants`)).map((r) => Number(r.lim))).toEqual([99]);
  });
});
