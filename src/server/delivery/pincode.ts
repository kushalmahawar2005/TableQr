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

// An address for a dropped pin or shared location, from OpenStreetMap's Nominatim (the same map
// data the guest sees). Also only a convenience: any failure returns null and the guest types it in.

export type PlaceAddress = { pincode: string; locality: string; line: string };

type OsmAddress = Partial<Record<"house_number" | "road" | "neighbourhood" | "suburb" | "quarter" | "residential" | "city_district" | "city" | "town" | "village" | "hamlet" | "county" | "state_district" | "state" | "postcode", string>>;

/** What the map says, plus what we need to check its pincode against India Post */
export type MapPlace = PlaceAddress & { district: string; state: string; names: string[] };

/** "12, MI Road" for the street; "Malviya Nagar, Jaipur" for the area; the map's pincode when it is six digits */
export function parseReverseResponse(body: unknown): MapPlace | null {
  const a: OsmAddress | undefined = body && typeof body === "object" && "address" in body ? (body as { address: OsmAddress }).address : undefined;
  if (!a) return null;
  const pin = (a.postcode ?? "").replace(/\s/g, "");
  const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.residential ?? a.city_district;
  // OSM often names the civic body ("Jaipur Municipal Corporation"); the district reads as the city people use
  const civic = (x?: string) => !!x && /municipal|corporation|nagar nigam|council|cantonment/i.test(x);
  const city = civic(a.city) ? (a.state_district ?? a.city!.replace(/\s+(municipal.*|nagar nigam.*)$/i, "")) : (a.city ?? a.town ?? a.village ?? a.state_district ?? a.county);
  const locality = [...new Set([area, city].filter((x): x is string => !!x?.trim()))].join(", ");
  const line = [a.house_number, a.road].filter(Boolean).join(", ");
  if (!locality && !line && !isPincode(pin)) return null;
  const names = [...new Set([a.neighbourhood, a.suburb, a.quarter, a.residential, a.village, a.hamlet, a.town, a.city_district].filter((x): x is string => !!x?.trim() && !civic(x)))];
  return { pincode: isPincode(pin) ? pin : "", locality: locality.slice(0, 100), line: line.slice(0, 200), district: a.state_district ?? "", state: a.state ?? "", names };
}

/** Spellings differ between the map and India Post ("Kukas" / "Kookas"): compare by sound */
export const sameName = (a: string, b: string) => {
  const key = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "").replace(/oo|ou/g, "u").replace(/ee/g, "i").replace(/aa/g, "a").replace(/w/g, "v").replace(/h/g, "");
  return !!key(a) && key(a) === key(b);
};
const sameDistrict = (a: string, b: string) => !a || !b || a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

/** Every spelling worth searching: "Kukas" also as "Kookas"; "Mansarovar" also as "Mansrovar" is left to the sound match */
function spellings(name: string) {
  const out = new Set([name]);
  for (const [from, to] of [["u", "oo"], ["oo", "u"], ["i", "ee"], ["ee", "i"]] as const) if (name.toLowerCase().includes(from)) out.add(name.replace(new RegExp(from, "i"), to));
  return [...out].slice(0, 4);
}

async function postOffices(name: string): Promise<PostOffice[]> {
  try {
    const res = await fetch(`https://api.postalpincode.in/postoffice/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(4000), next: { revalidate: 30 * 86400 } });
    const first = res.ok ? ((await res.json()) as { Status?: string; PostOffice?: (PostOffice & { Pincode?: string })[] }[])[0] : null;
    return first?.Status === "Success" && Array.isArray(first.PostOffice) ? first.PostOffice : [];
  } catch {
    return [];
  }
}

/**
 * Map pincodes in India are often wrong or not real. Keep the map's one only when India Post knows it in the
 * same district; else find the area's own post office by name in that district; else leave it for the guest.
 */
async function checkedPincode(place: MapPlace): Promise<string> {
  if (place.pincode) {
    const info = await lookupPincode(place.pincode);
    if (info && sameDistrict(info.city, place.district)) return place.pincode;
  }
  for (const name of place.names.slice(0, 3)) {
    for (const spelling of spellings(name)) {
      const hit = (await postOffices(spelling)).find((o) => sameName(o.Name ?? "", name) && sameDistrict(o.District ?? "", place.district) && (!place.state || o.State === place.state)) as (PostOffice & { Pincode?: string }) | undefined;
      if (hit?.Pincode && isPincode(hit.Pincode)) return hit.Pincode;
    }
  }
  return "";
}

export async function reverseGeocode(lat: number, lng: number): Promise<PlaceAddress | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // About 10 m: nearby taps share one cached answer, which keeps us well inside Nominatim's fair use
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en&lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Tableeqr delivery address (tableeqr)" }, signal: AbortSignal.timeout(5000), next: { revalidate: 30 * 86400 } });
    if (!res.ok) return null;
    const place = parseReverseResponse(await res.json());
    if (!place) return null;
    return { pincode: await checkedPincode(place), locality: place.locality, line: place.line };
  } catch {
    return null;
  }
}
