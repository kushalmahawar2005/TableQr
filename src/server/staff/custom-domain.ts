import "server-only";
import { randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";
import { resolveTxt } from "node:dns/promises";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { audit } from "./audit";
import type { StaffSession } from "./auth";

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId" | "name">;
const invalid = (message: string) => new AppError("invalid_state", message, { reason: "custom_domain" });

function normalizeDomain(input: unknown): string {
  const raw = String(input ?? "").trim().replace(/\.$/, "");
  if (!raw || raw.length > 253 || /[/:?#@\s]/.test(raw)) throw invalid("Enter a domain such as menu.example.com, without https:// or a path.");
  const ascii = domainToASCII(raw).toLowerCase();
  const labels = ascii.split(".");
  if (!ascii || labels.length < 2 || labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw invalid("Enter a valid public domain name.");
  }
  if (ascii === "localhost" || ascii.endsWith(".localhost") || ascii.endsWith(".local")) throw invalid("Local network domains cannot be connected.");
  return ascii;
}

export async function saveCustomDomain(staff: Staff, input: unknown, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can manage the restaurant domain.");
  const domain = input ? normalizeDomain(input) : null;
  if (domain) {
    const [claimed] = await db.select({ id: s.outlets.id }).from(s.outlets)
      .where(and(eq(s.outlets.customDomain, domain), ne(s.outlets.id, staff.outletId))).limit(1);
    if (claimed) throw invalid("That domain is already connected to another outlet.");
  }
  const token = domain ? randomBytes(24).toString("hex") : null;
  try {
    await db.transaction(async (tx) => {
      const [outlet] = await tx.select({ customDomain: s.outlets.customDomain, customDomainVerifiedAt: s.outlets.customDomainVerifiedAt, customDomainLive: s.outlets.customDomainLive })
        .from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
      if (!outlet) throw new AppError("not_found", "Outlet not found.");
      await tx.update(s.outlets).set({ customDomain: domain, customDomainToken: token, customDomainVerifiedAt: null, customDomainLive: false })
        .where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
      await audit(tx, staff, { action: "outlet.custom_domain_changed", entity: "outlet", entityId: staff.outletId, now,
        before: { domain: outlet.customDomain, verified: !!outlet.customDomainVerifiedAt, live: outlet.customDomainLive },
        after: { domain, verified: false, live: false } });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const wrapped = error as { code?: string; cause?: { code?: string } };
    if (wrapped?.code === "ER_DUP_ENTRY" || wrapped?.cause?.code === "ER_DUP_ENTRY") throw invalid("That domain is already connected to another outlet.");
    throw error;
  }
  return { domain, token, verified: false };
}

/** A verified domain is used for guest links only after the owner confirms Hostinger + HTTPS setup. */
export async function setCustomDomainLive(staff: Staff, live: boolean, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can manage the restaurant domain.");
  return db.transaction(async (tx) => {
    const [outlet] = await tx.select({ customDomain: s.outlets.customDomain, customDomainVerifiedAt: s.outlets.customDomainVerifiedAt, customDomainLive: s.outlets.customDomainLive })
      .from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
    if (!outlet) throw new AppError("not_found", "Outlet not found.");
    if (live && (!outlet.customDomain || !outlet.customDomainVerifiedAt)) throw invalid("Verify domain ownership before using it for guest links.");
    await tx.update(s.outlets).set({ customDomainLive: live }).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
    await audit(tx, staff, { action: live ? "outlet.custom_domain_enabled" : "outlet.custom_domain_disabled", entity: "outlet", entityId: staff.outletId, now,
      before: { domain: outlet.customDomain, live: outlet.customDomainLive }, after: { domain: outlet.customDomain, live } });
    return { live };
  });
}

export async function verifyCustomDomain(staff: Staff, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can verify the restaurant domain.");
  const [outlet] = await db.select({ customDomain: s.outlets.customDomain, customDomainToken: s.outlets.customDomainToken, customDomainVerifiedAt: s.outlets.customDomainVerifiedAt })
    .from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet?.customDomain || !outlet.customDomainToken) throw invalid("Save a domain first.");
  const recordName = `_tableqr-verify.${outlet.customDomain}`;
  let records: string[][] = [];
  try { records = await resolveTxt(recordName); } catch { /* DNS may still be propagating */ }
  const expected = `tableqr-verify=${outlet.customDomainToken}`;
  const found = records.some((parts) => parts.join("") === expected);
  if (!found) return { ok: false as const, message: `TXT record not found yet at ${recordName}. Check the record and wait for DNS to update.` };
  const result = await db.update(s.outlets).set({ customDomainVerifiedAt: now })
    .where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId), eq(s.outlets.customDomain, outlet.customDomain), eq(s.outlets.customDomainToken, outlet.customDomainToken)));
  if (result[0].affectedRows === 0) throw invalid("The domain settings changed. Refresh and try again.");
  await db.transaction(async (tx) => audit(tx, staff, { action: "outlet.custom_domain_verified", entity: "outlet", entityId: staff.outletId, now,
    after: { domain: outlet.customDomain, verified: true } }));
  return { ok: true as const, message: "Domain ownership verified. Add the domain to your hosting provider and enable HTTPS to make it live." };
}
