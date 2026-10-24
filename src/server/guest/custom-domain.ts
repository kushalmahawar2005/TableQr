import "server-only";
import { domainToASCII } from "node:url";
import { resolveTxt } from "node:dns/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

type DomainProof = { valid: boolean; expiresAt: number };
const proofCache = new Map<string, DomainProof>();
const PROOF_CACHE_MS = 60_000;

/** Exposed to integration tests so DNS changes can be checked without waiting on the short cache. */
export function clearCustomDomainProofCache() {
  proofCache.clear();
}

async function hasCurrentOwnershipProof(domain: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const key = `${domain}:${token}`;
  const cached = proofCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.valid;
  let valid = false;
  try {
    const records = await resolveTxt(`_tableqr-verify.${domain}`);
    valid = records.some((parts) => parts.join("") === `tableqr-verify=${token}`);
  } catch { /* DNS ownership proof was removed or is temporarily unavailable: fail closed. */ }
  proofCache.delete(key);
  proofCache.set(key, { valid, expiresAt: Date.now() + PROOF_CACHE_MS });
  if (proofCache.size > 1_000) proofCache.delete(proofCache.keys().next().value!);
  return valid;
}

/** Resolve an exact custom hostname; a live host must still prove DNS ownership. */
export async function customDomainForHost(host: string | null): Promise<{ outletCode: string; live: boolean; ownershipVerified: boolean } | null> {
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

  // isolation-exempt: match a globally unique public hostname before the tenant is known; return only public routing state.
  const [outlet] = await db.select({ code: s.outlets.code, live: s.outlets.customDomainLive, token: s.outlets.customDomainToken, verifiedAt: s.outlets.customDomainVerifiedAt })
    .from(s.outlets)
    .where(eq(s.outlets.customDomain, domain))
    .limit(1);
  if (!outlet) return null;
  const ownershipVerified = !!outlet.verifiedAt && outlet.live
    ? await hasCurrentOwnershipProof(domain, outlet.token)
    : false;
  return { outletCode: outlet.code, live: outlet.live, ownershipVerified };
}

export async function outletCodeForCustomDomain(host: string | null): Promise<string | null> {
  const outlet = await customDomainForHost(host);
  return outlet?.live && outlet.ownershipVerified ? outlet.outletCode : null;
}
