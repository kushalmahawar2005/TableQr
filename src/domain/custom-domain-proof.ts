/** Ownership record shown for every new or updated restaurant domain. */
export function customDomainProofRecord(domain: string, token: string) {
  return { name: `_tableeqr-verify.${domain}`, value: `tableeqr-verify=${token}` };
}
