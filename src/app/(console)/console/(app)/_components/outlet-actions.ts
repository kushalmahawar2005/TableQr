"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { STAFF_COOKIE, STAFF_SESSION_SECONDS, switchOutlet } from "@/server/staff/auth";

/** Owner or manager of several outlets: continue at another one without signing in again */
export async function switchOutletAction(outletId: string): Promise<{ error: string }> {
  const jar = await cookies();
  try {
    const { token } = await switchOutlet(jar.get(STAFF_COOKIE)?.value, String(outletId));
    jar.set(STAFF_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: STAFF_SESSION_SECONDS });
  } catch (err) {
    return { error: err instanceof AppError ? err.message : "Could not switch outlet. Try again." };
  }
  redirect("/console");
}
