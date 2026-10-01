"use server";
import { cookies, headers } from "next/headers";
import { formatRupees } from "@/domain/menu-price";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { getAfterVisit, requireVisit, submitFeedback } from "@/server/guest/after-visit";
import { publicOrigin } from "@/server/guest/invite";
import { sendReceipt, type ReceiptChannel } from "@/server/receipts/channels";

// G9 actions: read-only except one rating and sending your own receipt.

async function device() {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
}

export async function afterVisitAction(outlet: string, table: string) {
  try {
    return { ok: true as const, data: await getAfterVisit(outlet, table, await device()) };
  } catch {
    return { ok: false as const };
  }
}

export async function rateAction(outlet: string, table: string, rating: number) {
  try {
    const visit = await requireVisit(outlet, table, await device());
    return { ok: true as const, ...(await submitFeedback(visit, Number(rating))) };
  } catch {
    return { ok: false as const };
  }
}

export async function sendReceiptAction(outlet: string, table: string, channel: ReceiptChannel) {
  try {
    const visit = await requireVisit(outlet, table, await device());
    const data = await getAfterVisit(outlet, table, await device());
    const link = `${publicOrigin(await headers())}/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}/paid/receipt`;
    const res = await sendReceipt(visit, channel, {
      outletName: data && !data.expired ? data.outlet.name : "",
      amountText: data && !data.expired ? formatRupees(data.paidPaise + data.tipPaise) : "",
      link,
    });
    return { ok: res.ok, destination: res.destination };
  } catch {
    return { ok: false as const, destination: null };
  }
}
