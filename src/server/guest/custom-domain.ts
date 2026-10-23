import "server-only";
import { domainToASCII } from "node:url";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

/** Resolve only an exact, DNS-verified host. The verified-domain unique index makes this lookup unambiguous. */
export async function outletCodeForCustomDomain(host: string | null): Promise<string | null> {
  if (!host || /[\s,/@?#\\]/.test(host)) return null;

  let hostname: string;
  try {
    hostname = new URL(`https://${host}`).hostname.replace(/\.$/, "");
  } catch {
    return null;
  }

  const domain = domainToASCII(hostname).toLowerCase();
  const labels = domain.split(".");
  if (!domain || labels.length < 2 || labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;

  // isolation-exempt: resolve a globally unique public hostname before the tenant is known; return only its outlet code.
  const [outlet] = await db.select({ code: s.outlets.code })
    .from(s.outlets)
    .where(and(eq(s.outlets.customDomain, domain), isNotNull(s.outlets.customDomainVerifiedAt), eq(s.outlets.customDomainLive, true)))
    .limit(1);
  return outlet?.code ?? null;
}
