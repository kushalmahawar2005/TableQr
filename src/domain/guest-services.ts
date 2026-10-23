/** Public restaurant entry choices. Entitlements are checked separately from these owner choices. */
export const guestServices = ["dineIn", "reservations", "rooms"] as const;
export type GuestService = (typeof guestServices)[number];
export const GUEST_SERVICE_LABELS: Record<GuestService, { title: string; hint: string }> = {
  dineIn: { title: "Dine in", hint: "Show instructions to scan the QR code at the table." },
  reservations: { title: "Party reservations", hint: "Let guests choose a time and book a table online." },
  rooms: { title: "Hotel room service", hint: "Show instructions to scan the QR code in the guest’s room." },
};

/** Existing outlets keep all their entitled choices; an empty array intentionally hides all. */
export function configuredGuestServices(value: unknown): GuestService[] {
  if (!Array.isArray(value)) return [...guestServices];
  return guestServices.filter(service => value.includes(service));
}
