import "server-only";
import { cookies } from "next/headers";
import { uuidv7 } from "@/db/id";
import { DEVICE_COOKIE } from "@/lib/guest-device";

export const COOKIE_YEAR = 60 * 60 * 24 * 365;

export const guestCookie = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" } as const;

/** This phone's device id, created on first use. Only callable from server actions. */
export async function ensureDeviceId(): Promise<string> {
  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    deviceId = uuidv7();
    jar.set(DEVICE_COOKIE, deviceId, { ...guestCookie, maxAge: COOKIE_YEAR });
  }
  return deviceId;
}
