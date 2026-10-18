"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { uuidv7 } from "@/db/id";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import type { RoomRequestKind } from "@/domain/rooms";
import { AppError } from "@/server/errors";
import { askFromRoom } from "@/server/guest/room";
import { startOrJoinTable } from "@/server/guest/session";

const YEAR = 60 * 60 * 24 * 365;
const cookieBase = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" } as const;

async function device() {
  const jar = await cookies();
  let id = jar.get(DEVICE_COOKIE)?.value;
  if (!id) {
    id = uuidv7();
    jar.set(DEVICE_COOKIE, id, { ...cookieBase, maxAge: YEAR });
  }
  return id;
}

export type RoomResult = { error: string } | { ok: true; repeated: boolean } | null;

/** Order food: joins the room's food tab (opened now if needed) and goes to the menu */
export async function orderFood(outletCode: string, shortCode: string): Promise<RoomResult> {
  try {
    await startOrJoinTable({ outletCode, shortCode, deviceId: await device() });
  } catch (err) {
    return { error: err instanceof AppError ? err.message : "Something went wrong. Please try again." };
  }
  redirect(`/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}/menu`);
}

export async function askReception(outletCode: string, shortCode: string, kind: RoomRequestKind, note: string | null): Promise<RoomResult> {
  try {
    await device();
    const r = await askFromRoom(outletCode, shortCode, kind, note);
    return { ok: true, repeated: r.repeated };
  } catch (err) {
    return { error: err instanceof AppError ? err.message : "Could not send. Please try again." };
  }
}
