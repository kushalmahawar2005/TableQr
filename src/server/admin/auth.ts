import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import * as s from "@/db/schema";
import { verifyAdminPassword } from "./password";

const COOKIE = "tq_platform_admin";
const SESSION_HOURS = 12;

function secret() {
  const value = process.env.PLATFORM_ADMIN_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("PLATFORM_ADMIN_SESSION_SECRET must be at least 32 characters");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function tokenFor(id: string) {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `${id}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

async function adminFromToken(token: string | undefined) {
  if (!token) return null;
  const [id, expires, signature] = token.split(".");
  const payload = `${id}.${expires}`;
  if (!id || !expires || !signature || Number(expires) <= Date.now()) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [admin] = await db.select().from(s.platformAdmins).where(and(eq(s.platformAdmins.id, id), eq(s.platformAdmins.isActive, true)));
  return admin ?? null;
}

export async function currentPlatformAdmin() {
  return adminFromToken((await cookies()).get(COOKIE)?.value);
}

export async function signInPlatformAdmin(email: string, password: string) {
  const [admin] = await db.select().from(s.platformAdmins).where(and(eq(s.platformAdmins.email, email.trim().toLowerCase()), eq(s.platformAdmins.isActive, true)));
  if (!admin || !(await verifyAdminPassword(password, admin.passwordHash))) return false;
  const jar = await cookies();
  jar.set(COOKIE, tokenFor(admin.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600 });
  await db.update(s.platformAdmins).set({ lastLoginAt: new Date() }).where(eq(s.platformAdmins.id, admin.id));
  return true;
}

export async function signOutPlatformAdmin() {
  (await cookies()).delete(COOKIE);
}

export async function requirePlatformAdmin() {
  const admin = await currentPlatformAdmin();
  if (!admin) throw new Error("Platform admin sign-in required");
  return admin;
}
