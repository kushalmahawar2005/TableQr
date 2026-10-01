"use server";
import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { passHost, removeParticipant, setOrderingLocked } from "@/server/guest/host-controls";
import { guestContextForDevice } from "@/server/guest/menu-screen";
import { getTableScreen } from "@/server/guest/table-screen";
import { guestRealtimeToken } from "@/server/realtime/token";

// G7 actions. Service requests and Request bill reuse G6's action (orders/actions.ts) unchanged.

export type HostError = "gone" | "host_only" | "blocked" | "changed" | "failed";

async function device() {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
}

function errorOf(err: unknown): HostError {
  if (!(err instanceof AppError)) return "failed";
  if (["session_expired", "qr_revoked", "outlet_unavailable", "participant_removed"].includes(err.code)) return "gone";
  if (err.details?.reason === "host_only") return "host_only";
  if (err.code === "table_settling") return "blocked";
  // The person left, paid, was removed, or someone else acted first: show the latest table
  if (err.code === "invalid_state" || err.code === "not_found") return "changed";
  return "failed";
}

export async function tableDataAction(outlet: string, table: string) {
  try {
    return { ok: true as const, data: await getTableScreen(outlet, table, await device()) };
  } catch (err) {
    const error = errorOf(err);
    return { ok: false as const, error: error === "changed" ? "gone" : error };
  }
}

export async function tableTokenAction(outlet: string, table: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    return guestRealtimeToken(ctx);
  } catch {
    return null;
  }
}

export async function setOrderingAction(outlet: string, table: string, locked: boolean) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    await setOrderingLocked(ctx, locked === true);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: errorOf(err) };
  }
}

export async function removePersonAction(outlet: string, table: string, participantId: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    await removeParticipant(ctx, String(participantId));
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: errorOf(err) };
  }
}

export async function passHostAction(outlet: string, table: string, participantId: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    await passHost(ctx, String(participantId));
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: errorOf(err) };
  }
}
