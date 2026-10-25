"use server";

import { AppError } from "@/server/errors";
import { consoleKitchen, kdsAccept, kdsBoard, kdsOlder, kdsBumpLine, kdsBumpTicket, kdsRealtimeToken, kdsRecall, kdsSearch, kdsStart, kdsStock } from "@/server/kitchen/kds";
import { kdsWorkRoles } from "@/lib/staff-permissions";
import { staffFor } from "@/server/staff/request";
import type { KdsResult } from "@/app/(staff)/kds/actions";

// The kitchen board inside the console: the same board and rules as the wall screen, acting as the
// signed-in staff member (kitchen, manager or owner) instead of a device.

const kitchen = async () => consoleKitchen(await staffFor(kdsWorkRoles, "kitchen"));

async function run<T>(work: () => Promise<T>): Promise<KdsResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message, reason: (err.details?.reason as string | undefined) ?? undefined };
    console.error("[console kitchen] action failed", err);
    return { ok: false, code: "failed", message: "That didn't go through. Try again." };
  }
}

export async function boardAction(station: string | null) {
  return run(async () => kdsBoard(await kitchen(), station ? String(station) : null));
}
export async function olderAction(station: string | null, offset: number, limit: number) {
  return run(async () => kdsOlder(await kitchen(), station ? String(station) : null, Number(offset) || 0, Number(limit) || 12));
}
export async function tokenAction() {
  try {
    return kdsRealtimeToken(await kitchen());
  } catch {
    return null;
  }
}
export const acceptAction = async (ticketId: string) => run(async () => kdsAccept(await kitchen(), ticketId));
export const startAction = async (ticketId: string) => run(async () => kdsStart(await kitchen(), ticketId));
export const bumpTicketAction = async (ticketId: string) => run(async () => kdsBumpTicket(await kitchen(), ticketId));
export const bumpLineAction = async (lineId: string) => run(async () => kdsBumpLine(await kitchen(), lineId));
export const recallAction = async (ticketId: string) => run(async () => kdsRecall(await kitchen(), ticketId));
export const stockAction = async (itemId: string, outOfStock: boolean) =>
  run(async () => {
    const res = await kdsStock(await kitchen(), itemId, outOfStock === true);
    return { cartsAffected: res.cartsAffected };
  });
export const searchAction = async (q: string) => run(async () => kdsSearch(await kitchen(), String(q ?? "")));
