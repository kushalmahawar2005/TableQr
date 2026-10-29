"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RIDER_COOKIE, RIDER_OUTLET_COOKIE } from "@/server/staff/rider-request";
import { AppError } from "@/server/errors";
import { STAFF_SESSION_HOURS, resolveStaff, signInStaff, signOutStaff } from "@/server/staff/auth";

export type RiderSignInState = { error: string | null; outlet: string; phone: string };

const OUTLET_COOKIE = RIDER_OUTLET_COOKIE;

export async function signInRiderAction(_previous: RiderSignInState, form: FormData): Promise<RiderSignInState> {
  const outlet = String(form.get("outlet") ?? "").trim().toUpperCase().slice(0, 12);
  const phone = String(form.get("phone") ?? "").slice(0, 20);
  const pin = String(form.get("pin") ?? "");
  try {
    const jar = await cookies();
    const { token } = await signInStaff({ outletCode: outlet, phone, pin, asRole: "rider" });
    const rider = await resolveStaff(token);
    if (!rider?.roles.includes("rider")) {
      await signOutStaff(token);
      return { error: "This account isn't assigned to the Rider role. Ask the restaurant owner.", outlet, phone };
    }
    await signOutStaff(jar.get(RIDER_COOKIE)?.value);
    jar.set(RIDER_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: STAFF_SESSION_HOURS * 3600 });
    jar.set(OUTLET_COOKIE, outlet, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
  } catch (error) {
    return { error: error instanceof AppError ? error.message : "Sign-in didn't go through. Try again.", outlet, phone };
  }
  redirect("/rider");
}

export async function signOutRiderAction() {
  const jar = await cookies();
  await signOutStaff(jar.get(RIDER_COOKIE)?.value);
  jar.delete(RIDER_COOKIE);
  redirect("/rider/login");
}
