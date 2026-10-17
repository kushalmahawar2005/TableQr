import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { getGstReport } from "@/server/staff/gst-report";
import { resetTestDb } from "./setup-db";

// The GST report reads the outlet's invoices for a month on India time, and nobody else's.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const owner = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: ["owner" as const] });

async function invoice(tenantId: string, outletId: string, seq: number, issuedAt: Date, extra: Partial<typeof s.invoices.$inferInsert> = {}) {
  const billId = uuidv7();
  const sessionId = uuidv7();
  const tableId = (await env.db.select({ id: s.diningTables.id }).from(s.diningTables).limit(1))[0].id;
  await env.db.insert(s.tableSessions).values({ id: sessionId, tenantId, outletId, tableId, status: "closed", closedAt: issuedAt } as typeof s.tableSessions.$inferInsert);
  await env.db.insert(s.bills).values({ id: billId, tenantId, outletId, sessionId, status: "paid", subtotalPaise: 100000, taxPaise: 5000, totalPaise: 105000, closedAt: issuedAt });
  await env.db.insert(s.invoices).values({
    tenantId, outletId, billId, financialYear: "26-27", seq, number: `SRJ01/26-27/${String(seq).padStart(6, "0")}`, totalPaise: 105000, issuedAt,
    snapshot: { subtotalPaise: 100000, discountPaise: 0, serviceChargePaise: 0, taxPaise: 5000, roundOffPaise: 0, totalPaise: 105000, taxBreakup: { "500": 5000 }, paymentModes: { upi: 105000 } },
    ...extra,
  });
}

beforeAll(async () => {
  env = await resetTestDb();
  const { tenantId, outletId } = env.demo;
  // 1 Oct 00:10 IST is still 30 Sep in UTC, and belongs to October
  await invoice(tenantId, outletId, 1, new Date("2026-09-30T18:40:00Z"));
  await invoice(tenantId, outletId, 2, new Date("2026-10-15T08:00:00Z"), { customerGstin: "08ABCDE1234F1Z5", customerName: "Acme Pvt Ltd" });
  // 31 Oct 23:59 IST is in October; 1 Nov 00:00 IST is not
  await invoice(tenantId, outletId, 3, new Date("2026-10-31T18:29:00Z"));
  await invoice(tenantId, outletId, 4, new Date("2026-10-31T18:30:00Z"));
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("GST report", () => {
  it("sums a month of invoices on India time, with B2B apart", async () => {
    const r = await getGstReport(owner(), "2026-10", new Date("2026-11-02T00:00:00Z"));
    expect(r.rows.map((x) => x.number)).toEqual(["SRJ01/26-27/000001", "SRJ01/26-27/000002", "SRJ01/26-27/000003"]);
    expect(r.summary.taxablePaise).toBe(300000);
    expect(r.summary.cgstPaise + r.summary.sgstPaise).toBe(15000);
    expect(r.summary.b2b.map((b) => b.customerName)).toEqual(["Acme Pvt Ltd"]);
    expect([r.summary.firstNumber, r.summary.lastNumber]).toEqual(["SRJ01/26-27/000001", "SRJ01/26-27/000003"]);
    expect((await getGstReport(owner(), "2026-11")).rows.map((x) => x.number)).toEqual(["SRJ01/26-27/000004"]);
  });

  it("shows nothing of another restaurant, and only to roles that see reports", async () => {
    const other = await getGstReport({ tenantId: env.other.tenantId, outletId: env.other.outletId, roles: ["owner"] }, "2026-10");
    expect(other.rows).toEqual([]);
    const err = await getGstReport({ ...owner(), roles: ["waiter"] }, "2026-10").then(() => null, (e: unknown) => e);
    expect((err as AppError).code).toBe("forbidden");
  });
});
