import "server-only";
import { sql } from "drizzle-orm";
import { financialYear, formatInvoiceNumber } from "@/domain/invoice";
import type { Tx } from "../db-types";

/**
 * Takes the next gapless invoice number for an outlet (PS 6.2). Must run inside the
 * transaction that creates the invoice: the counter row stays locked until commit, and a
 * rollback gives the number back, so the series never skips.
 */
export async function nextInvoiceNumber(
  tx: Tx,
  outlet: { tenantId: string; id: string; code: string; timezone: string },
  now = new Date(),
) {
  const fy = financialYear(now, outlet.timezone);
  await tx.execute(sql`
    INSERT INTO invoice_series (tenant_id, outlet_id, financial_year, last_seq)
    VALUES (${outlet.tenantId}, ${outlet.id}, ${fy}, LAST_INSERT_ID(1))
    ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)
  `);
  const [rows] = (await tx.execute(sql`SELECT LAST_INSERT_ID() AS seq`)) as unknown as [{ seq: number | string }[]];
  const seq = Number(rows[0].seq);
  return { financialYear: fy, seq, number: formatInvoiceNumber(outlet.code, fy, seq) };
}
