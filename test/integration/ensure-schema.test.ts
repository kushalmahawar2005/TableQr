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
  (await rows<{ c: string }>(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME IN ('kitchen_display', 'table_limit', 'custom_features', 'custom_price_paise', 'business_size')`)).map((r) => r.c).sort();

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  // This suite deliberately rewinds the test schema to emulate a pre-release production DB.
  // Drop that temporary schema after the assertions so following integration suites can migrate
  // from a clean database instead of inheriting the simulated legacy migration journal.
  if (env) {
    const [databaseRows] = await env.conn.query("SELECT DATABASE() AS db");
    const databaseName = String((databaseRows as Array<{ db?: string }>)[0]?.db ?? "");
    if (databaseName !== "tableqr_test") throw new Error("Refusing to clean a non-test database");
    await env.conn.query("SET FOREIGN_KEY_CHECKS = 0");
    const [tableRows] = await env.conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    for (const row of tableRows as Array<Record<string, unknown>>) {
      const name = String(Object.values(row)[0]).replace(/`/g, "``");
      await env.conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await env.conn.query("SET FOREIGN_KEY_CHECKS = 1");
    await env.conn.end();
  }
  await appDb.$client.end();
});

describe("schema update at startup", () => {
  it("adds what is missing, fills the defaults, records the migrations, and does nothing the second time", async () => {
    await env.db.execute(sql`ALTER TABLE tenants DROP COLUMN kitchen_display, DROP COLUMN table_limit, DROP COLUMN custom_features, DROP COLUMN custom_price_paise, DROP COLUMN business_size`);
    await env.db.execute(sql`ALTER TABLE users DROP COLUMN duty_status, DROP COLUMN duty_changed_at, DROP COLUMN last_seen_at`);
    await env.db.execute(sql`ALTER TABLE table_sessions DROP FOREIGN KEY fk_sessions_waiter, DROP COLUMN waiter_user_id`);
    await env.db.execute(sql`DROP TABLE staff_push_subscriptions`);
    await env.db.execute(sql`DROP TABLE delivery_otp_challenges`);
    await env.db.execute(sql`DROP TABLE delivery_checkouts`);
    await env.db.execute(sql`ALTER TABLE table_sessions DROP COLUMN delivery_fee_paise`);
    await env.db.execute(sql`ALTER TABLE bills DROP COLUMN delivery_fee_paise`);
    await env.db.execute(sql`DROP TABLE plan_requests`);
    await env.db.execute(sql`DROP TABLE fee_payments`);
    await env.db.execute(sql`DROP TABLE room_requests, room_stays, rooms`);
    await env.db.execute(sql`ALTER TABLE orders DROP COLUMN at_counter`);
    await env.db.execute(sql`ALTER TABLE cart_lines DROP COLUMN personal_for_pickup`);
    await env.db.execute(sql`ALTER TABLE order_lines DROP COLUMN personal_for_pickup`);
    await env.db.execute(sql`ALTER TABLE users DROP COLUMN guide`);
    await env.db.execute(sql`ALTER TABLE outlets DROP COLUMN guest_online_payments`);
    await env.db.execute(sql`ALTER TABLE outlets DROP COLUMN custom_domain_live`);
    await env.db.execute(sql`ALTER TABLE outlets DROP COLUMN guest_services`);
    await env.db.execute(sql`ALTER TABLE outlets DROP COLUMN delivery_policy`);
    await env.db.execute(sql`ALTER TABLE outlets DROP COLUMN booking_payment_mode, DROP COLUMN booking_payment_qr_url`);
    await env.db.execute(sql`ALTER TABLE reservations DROP COLUMN manual_advance_reference, DROP COLUMN manual_advance_claimed_at, DROP COLUMN manual_advance_confirmed_at, DROP COLUMN advance_payment_mode, DROP COLUMN advance_payment_qr_url, DROP COLUMN booking_device_id`);
    await env.db.execute(sql`ALTER TABLE staff_roles MODIFY COLUMN role enum('owner','manager','cashier','host','waiter','kitchen','accountant') NOT NULL`);
    await env.db.execute(sql`DELETE FROM plans WHERE code IN ('custom', 'hotel', 'hotel_plus')`);
    // Production still had the old limits
    await env.db.execute(sql`UPDATE plans SET features = JSON_SET(features, '$.maxTables', 15, '$.maxStaff', 3) WHERE code = 'starter'`);
    await env.db.execute(sql`UPDATE plans SET features = JSON_SET(features, '$.maxTables', 40, '$.maxStaff', 10) WHERE code = 'growth'`);
    await env.db.execute(sql`UPDATE plans SET features = JSON_SET(features, '$.maxTables', 80, '$.maxStaff', 25) WHERE code = 'pro'`);
    await env.db.execute(sql`UPDATE plans SET features = JSON_REMOVE(features, '$.kitchenDisplay', '$.waiterApp', '$.discounts', '$.whatsappBills', '$.reservations', '$.fullReports', '$.dineIn', '$.rooms', '$.maxRooms')`);
    await env.db.execute(sql`DELETE FROM __drizzle_migrations WHERE created_at > 1791043208000`);
    expect(await columns()).toEqual([]);

    await ensureSchema(appDb.$client);
    expect(await columns()).toEqual(["business_size", "custom_features", "custom_price_paise", "kitchen_display", "table_limit"]);
    expect(Number((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('plan_requests', 'fee_payments', 'rooms', 'room_stays', 'room_requests')`))[0].n)).toBe(5);
    expect(String((await rows<{ t: string }>(sql`SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_roles' AND COLUMN_NAME = 'role'`))[0].t)).toContain("'reception'");
    const plans = await rows<{ code: string; kds: string }>(sql`SELECT code, JSON_EXTRACT(features, '$.kitchenDisplay') AS kds FROM plans ORDER BY sort_order`);
    expect(Object.fromEntries(plans.map((p) => [p.code, String(p.kds)]))).toEqual({ starter: "false", growth: "false", pro: "true", chain: "true", hotel: "true", hotel_plus: "true", custom: "false" });
    // The new switches: Starter gets none, Growth all but full reports, higher plans everything
    const switches = await rows<{ code: string; w: string; r: string }>(sql`SELECT code, JSON_EXTRACT(features, '$.waiterApp') AS w, JSON_EXTRACT(features, '$.fullReports') AS r FROM plans ORDER BY sort_order`);
    expect(switches.map((p) => `${p.code}:${p.w}/${p.r}`)).toEqual(["starter:false/false", "growth:true/false", "pro:true/true", "chain:true/true", "hotel:false/true", "hotel_plus:true/true", "custom:false/false"]);
    // Restaurant plans keep their tables and get no rooms; the two hotel plans have rooms
    const hotel = await rows<{ code: string; d: string; r: string }>(sql`SELECT code, JSON_EXTRACT(features, '$.dineIn') AS d, JSON_EXTRACT(features, '$.rooms') AS r FROM plans ORDER BY sort_order`);
    expect(hotel.map((p) => `${p.code}:${p.d}/${p.r}`)).toEqual(["starter:true/false", "growth:true/false", "pro:true/false", "chain:true/false", "hotel:false/true", "hotel_plus:true/true", "custom:true/false"]);
    const limits2 = await rows<{ code: string; t: string; s: string }>(sql`SELECT code, JSON_EXTRACT(features, '$.maxTables') AS t, JSON_EXTRACT(features, '$.maxStaff') AS s FROM plans WHERE code IN ('starter', 'growth', 'pro') ORDER BY sort_order`);
    expect(limits2.map((p) => `${p.code}:${p.t}/${p.s}`)).toEqual(["starter:6/3", "growth:12/6", "pro:20/20"]);
    // Existing restaurants keep the tables they run today as their limit
    const limits = await rows<{ n: number; lim: number }>(sql`SELECT t.table_limit AS lim, (SELECT COUNT(*) FROM dining_tables d WHERE d.tenant_id = t.id AND d.is_active = 1) AS n FROM tenants t`);
    for (const l of limits) expect(Number(l.lim)).toBe(Math.max(1, Number(l.n)));
    const recorded = await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE created_at > 1791043208000`);
    expect(Number(recorded[0].n)).toBe(36);
    expect(Number((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admin_login_buckets'`))[0].n)).toBe(1);
    const deliveryColumns = await rows<{ c: string }>(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_checkouts' AND COLUMN_NAME IN ('payment_mode', 'payment_provider', 'gateway_ref', 'gateway_payment_id', 'payment_status', 'payment_failure_reason', 'refund_gateway_ref', 'refund_status', 'refund_amount_paise') ORDER BY COLUMN_NAME`);
    expect(deliveryColumns.map((r) => r.c)).toEqual(["gateway_payment_id", "gateway_ref", "payment_failure_reason", "payment_mode", "payment_provider", "payment_status", "refund_amount_paise", "refund_gateway_ref", "refund_status"]);
    const deliveryIndexes = await rows<{ i: string }>(sql`SELECT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_checkouts' AND INDEX_NAME IN ('delivery_gateway_ref_uq', 'delivery_refund_gateway_ref_uq', 'delivery_payment_status_idx') GROUP BY INDEX_NAME ORDER BY INDEX_NAME`);
    expect(deliveryIndexes.map((r) => r.i)).toEqual(["delivery_gateway_ref_uq", "delivery_payment_status_idx", "delivery_refund_gateway_ref_uq"]);
    const manualDeliveryColumns = await rows<{ c: string }>(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_checkouts' AND COLUMN_NAME IN ('manual_payment_qr_url', 'manual_payment_reference', 'manual_payment_claimed_at', 'manual_payment_confirmed_at') ORDER BY COLUMN_NAME`);
    expect(manualDeliveryColumns.map((r) => r.c)).toEqual(["manual_payment_claimed_at", "manual_payment_confirmed_at", "manual_payment_qr_url", "manual_payment_reference"]);
    const manualDeliveryIndexes = await rows<{ i: string }>(sql`SELECT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_checkouts' AND INDEX_NAME IN ('delivery_manual_reference_uq', 'delivery_manual_pending_idx') GROUP BY INDEX_NAME ORDER BY INDEX_NAME`);
    expect(manualDeliveryIndexes.map((r) => r.i)).toEqual(["delivery_manual_pending_idx", "delivery_manual_reference_uq"]);
    const courierColumns = await rows<{ c: string }>(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_checkouts' AND COLUMN_NAME IN ('courier_name', 'courier_phone', 'courier_assigned_at') ORDER BY COLUMN_NAME`);
    expect(courierColumns.map((r) => r.c)).toEqual(["courier_assigned_at", "courier_name", "courier_phone"]);
    const pickupColumns = await rows<{ c: string }>(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_checkouts' AND COLUMN_NAME IN ('service_mode', 'collected_at') ORDER BY COLUMN_NAME`);
    expect(pickupColumns.map((r) => r.c)).toEqual(["collected_at", "service_mode"]);
    const pickupSchema = await rows<{ addressNullable: string; statusType: string; serviceModeDefault: string }>(sql`SELECT MAX(CASE WHEN COLUMN_NAME = 'address' THEN IS_NULLABLE END) AS addressNullable, MAX(CASE WHEN COLUMN_NAME = 'status' THEN COLUMN_TYPE END) AS statusType, MAX(CASE WHEN COLUMN_NAME = 'service_mode' THEN COLUMN_DEFAULT END) AS serviceModeDefault FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_checkouts'`);
    expect(pickupSchema[0]).toMatchObject({ addressNullable: "YES", serviceModeDefault: "delivery" });
    expect(pickupSchema[0].statusType).toContain("'collected'");
    const feeColumns = await rows<{ c: string }>(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_payments' AND COLUMN_NAME IN ('client_request_id', 'gateway_ref', 'gateway_payment_id', 'failure_reason', 'checked_at') ORDER BY COLUMN_NAME`);
    expect(feeColumns.map((r) => r.c)).toEqual(["checked_at", "client_request_id", "failure_reason", "gateway_payment_id", "gateway_ref"]);
    expect(String((await rows<{ t: string }>(sql`SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_payments' AND COLUMN_NAME = 'method'`))[0].t)).toContain("'cashfree'");
    // Counter items: every order made before this release was a normal order
    expect(String((await rows<{ d: string }>(sql`SELECT COLUMN_DEFAULT AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'at_counter'`))[0]?.d)).toMatch(/^(0|false)$/);
    expect(Number((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = 'cart_lines' AND COLUMN_NAME = 'personal_for_pickup') OR (TABLE_NAME = 'order_lines' AND COLUMN_NAME = 'personal_for_pickup'))`))[0].n)).toBe(2);
    // Everyone sees the first-run guide once
    expect((await rows<{ g: unknown }>(sql`SELECT DISTINCT guide AS g FROM users`)).map((r) => r.g)).toEqual([null]);
    // Staff start on duty
    expect((await rows<{ s: string }>(sql`SELECT DISTINCT duty_status AS s FROM users`)).map((r) => r.s)).toEqual(["on"]);

    expect((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'table_sessions' AND COLUMN_NAME = 'waiter_user_id'`))[0].n).toBe(1);
    expect((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'preorder'`))[0].n).toBe(1);
    expect((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outlets' AND COLUMN_NAME = 'guest_online_payments'`))[0].n).toBe(1);
    expect((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outlets' AND COLUMN_NAME = 'guest_services'`))[0].n).toBe(1);
    expect((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outlets' AND COLUMN_NAME = 'custom_domain_live'`))[0].n).toBe(1);
    expect(String((await rows<{ d: string }>(sql`SELECT COLUMN_DEFAULT AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outlets' AND COLUMN_NAME = 'custom_domain_live'`))[0].d)).toMatch(/^(0|false)$/);
    expect((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME IN ('manual_advance_reference', 'manual_advance_claimed_at', 'manual_advance_confirmed_at', 'advance_payment_mode', 'advance_payment_qr_url', 'booking_device_id')`))[0].n).toBe(6);
    expect((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_push_subscriptions'`))[0].n).toBe(1);
    // Second start: nothing changes, nothing is recorded twice
    await env.db.execute(sql`UPDATE tenants SET table_limit = 99`);
    await ensureSchema(appDb.$client);
    expect(Number((await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE created_at > 1791043208000`))[0].n)).toBe(36);
    expect((await rows<{ lim: number }>(sql`SELECT DISTINCT table_limit AS lim FROM tenants`)).map((r) => Number(r.lim))).toEqual([99]);
  });
});
