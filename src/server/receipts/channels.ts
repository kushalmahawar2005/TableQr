import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";

// Receipt delivery (PS 3.8): WhatsApp, SMS or email. A channel is offered only when a provider
// is configured and working; every send is recorded with its real outcome. No provider is
// connected yet (SMS needs DLT templates, WhatsApp needs approved templates), so none is offered.

export type ReceiptChannel = (typeof s.receiptChannels)[number];

export interface ReceiptSender {
  readonly channel: ReceiptChannel;
  send(input: { to: string; outletName: string; amountText: string; link: string }): Promise<{ ok: boolean; ref?: string }>;
}

const senders = new Map<ReceiptChannel, ReceiptSender>();

/** Providers register themselves at start-up once configured; tests register fakes */
export function registerReceiptSender(sender: ReceiptSender | null, channel?: ReceiptChannel) {
  if (sender) senders.set(sender.channel, sender);
  else if (channel) senders.delete(channel);
}

export function configuredReceiptChannels(): ReceiptChannel[] {
  return s.receiptChannels.filter((c) => senders.has(c));
}

const mask = (to: string) => (to.length > 6 ? `${to.slice(0, 5)}${"x".repeat(Math.max(0, to.length - 7))}${to.slice(-2)}` : "xxxx");

/** Sends the receipt link on a configured channel to the guest's own verified number */
export async function sendReceipt(
  visit: { tenantId: string; outletId: string; sessionId: string; participantId: string },
  channel: ReceiptChannel,
  input: { outletName: string; amountText: string; link: string },
) {
  const sender = senders.get(channel);
  if (!sender) throw new AppError("invalid_state", "This receipt option is not available.");
  const [row] = await db
    .select({ phone: s.guests.phone, billId: s.bills.id })
    .from(s.participants)
    .innerJoin(s.bills, and(eq(s.bills.tenantId, s.participants.tenantId), eq(s.bills.sessionId, s.participants.sessionId)))
    .leftJoin(s.guests, and(eq(s.guests.tenantId, s.participants.tenantId), eq(s.guests.id, s.participants.guestId)))
    .where(and(eq(s.participants.tenantId, visit.tenantId), eq(s.participants.id, visit.participantId)));
  // Email needs an address we do not collect yet; SMS and WhatsApp need a verified number
  const to = channel === "email" ? null : row?.phone;
  if (!row || !to) throw new AppError("invalid_state", "We do not have a verified number for you.", { reason: "no_destination" });
  const [delivery] = await db
    .insert(s.receiptDeliveries)
    .values({ tenantId: visit.tenantId, outletId: visit.outletId, billId: row.billId, participantId: visit.participantId, channel, destination: mask(to), status: "queued" })
    .$returningId();
  let res: { ok: boolean; ref?: string };
  try {
    res = await sender.send({ to, ...input });
  } catch {
    res = { ok: false };
  }
  await db
    .update(s.receiptDeliveries)
    .set({ status: res.ok ? "sent" : "failed", providerRef: res.ref ?? null })
    .where(and(eq(s.receiptDeliveries.tenantId, visit.tenantId), eq(s.receiptDeliveries.id, delivery.id)));
  return { ok: res.ok, destination: mask(to) };
}
