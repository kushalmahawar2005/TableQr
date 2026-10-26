import "server-only";

// City, state and delivery areas for an Indian pincode, from India Post's public directory.
// Only a convenience for the address form: any failure returns null and the guest types it in.

export type PincodeInfo = { city: string; state: string; areas: string[] };

type PostOffice = { Name?: string; District?: string; State?: string; DeliveryStatus?: string };

export const isPincode = (pin: string) => /^[1-9]\d{5}$/.test(pin);

/** Delivering offices first, "Malviya Nagar (Jaipur)" shown as "Malviya Nagar", no repeats */
export function parsePincodeResponse(body: unknown): PincodeInfo | null {
  const first = Array.isArray(body) ? body[0] : null;
  const offices: PostOffice[] = first && first.Status === "Success" && Array.isArray(first.PostOffice) ? first.PostOffice : [];
  if (!offices.length) return null;
  const sorted = [...offices].sort((a, b) => Number(b.DeliveryStatus === "Delivery") - Number(a.DeliveryStatus === "Delivery"));
  const areas = [...new Set(sorted.map((o) => (o.Name ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim()).filter(Boolean))].slice(0, 12);
  const city = offices[0].District?.trim() ?? "";
  const state = offices[0].State?.trim() ?? "";
  return city ? { city, state, areas } : null;
}

export async function lookupPincode(pin: string): Promise<PincodeInfo | null> {
  if (!isPincode(pin)) return null;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(4000), next: { revalidate: 7 * 86400 } });
    if (!res.ok) return null;
    return parsePincodeResponse(await res.json());
  } catch {
    return null;
  }
}
