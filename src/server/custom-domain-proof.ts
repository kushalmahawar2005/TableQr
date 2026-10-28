import "server-only";
import { resolveTxt } from "node:dns/promises";
import { customDomainProofRecord } from "@/domain/custom-domain-proof";

/** Existing verified domains may keep their original record during the brand transition. */
export async function hasCustomDomainProof(domain: string, token: string) {
  const records = [
    customDomainProofRecord(domain, token),
    { name: `_tableqr-verify.${domain}`, value: `tableqr-verify=${token}` },
  ];
  for (const record of records) {
    try {
      const values = await resolveTxt(record.name);
      if (values.some((parts) => parts.join("") === record.value)) return true;
    } catch { /* Missing ownership proof fails closed after both supported records are checked. */ }
  }
  return false;
}
