import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { qrSvg } from "./qr-svg";

type Scope = { tenantId: string; outletId: string };

export type TableQr = { tableCode: string; outletName: string; url: string; svg: string; joinCode: string | null } | null;

/** Where guests land after scanning: a live outlet domain, then configured address, then request host. */
export async function publicBaseUrl(scope?: Scope) {
  if (scope) {
    const [outlet] = await db.select({ customDomain: s.outlets.customDomain, customDomainVerifiedAt: s.outlets.customDomainVerifiedAt, customDomainLive: s.outlets.customDomainLive })
      .from(s.outlets).where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));
    if (outlet?.customDomain && outlet.customDomainVerifiedAt && outlet.customDomainLive) return `https://${outlet.customDomain}`;
  }
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The live QR of one table at the signed-in outlet; null when the table has no active QR yet (not published). */
export async function getTableQr(staff: Scope & { outlet: { code: string; name: string } }, tableId: string): Promise<TableQr> {
  const [row] = await db
    .select({ code: s.diningTables.code, joinCode: s.diningTables.joinCode, shortCode: s.qrCodes.shortCode })
    .from(s.diningTables)
    .innerJoin(s.qrCodes, and(eq(s.qrCodes.tenantId, s.diningTables.tenantId), eq(s.qrCodes.tableId, s.diningTables.id), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt)))
    .where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.id, tableId)));
  if (!row) return null;
  const url = `${await publicBaseUrl(staff)}/r/${staff.outlet.code}/t/${row.shortCode}`;
  if (!url) throw new AppError("not_found", "QR link is not available.");
  return { tableCode: row.code, outletName: staff.outlet.name, url, svg: qrSvg(url, 240), joinCode: row.joinCode };
}
