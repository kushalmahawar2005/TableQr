"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homeFor } from "@/lib/console-nav";
import { AppError } from "@/server/errors";
import { STAFF_COOKIE, STAFF_SESSION_HOURS, resolveStaff, signInStaff, signOutStaff } from "@/server/staff/auth";

export type SignInState = { error: string | null; outlet: string; phone: string };

const OUTLET_COOKIE = "tq_staff_outlet";

export async function signInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const outlet = String(form.get("outlet") ?? "").trim().toUpperCase().slice(0, 12);
  const phone = String(form.get("phone") ?? "").slice(0, 20);
  let destination = "/console/floor";
  try {
    const { token } = await signInStaff({ outletCode: outlet, phone, pin: String(form.get("pin") ?? "") });
    const staff = await resolveStaff(token);
    if (staff) destination = homeFor(staff.roles);
    const jar = await cookies();
    jar.set(STAFF_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: STAFF_SESSION_HOURS * 3600 });
    // Not secret: saves typing the outlet code on this tablet next time
    jar.set(OUTLET_COOKIE, outlet, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
  } catch (err) {
    return { error: err instanceof AppError ? err.message : "Sign-in didn't go through. Try again.", outlet, phone };
  }
  redirect(destination);
}

export async function signOutAction() {
  const jar = await cookies();
  await signOutStaff(jar.get(STAFF_COOKIE)?.value);
  jar.delete(STAFF_COOKIE);
  redirect("/console/login");
}
