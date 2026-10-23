import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import * as s from "@/db/schema";
import { verifyAdminPassword } from "./password";

const COOKIE = "tq_platform_admin";
const SESSION_HOURS = 12;
const ADMIN_LOGIN = { maxAttempts: 5, windowMs: 15 * 60_000 } as const;
const DUMMY_PASSWORD_HASH = "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalizedEmail.length > 160 || !normalizedEmail.includes("@") || typeof password !== "string" || password.length > 1_024) return false;
  const [admin] = await db.select().from(s.platformAdmins).where(and(eq(s.platformAdmins.email, normalizedEmail), eq(s.platformAdmins.isActive, true)));
  const now = new Date();
  const bucketKey = createHmac("sha256", secret()).update(`platform-admin-login:${admin?.id ?? "unknown"}`).digest("hex");
  const valid = await db.transaction(async (tx) => {
    await tx.insert(s.platformAdminLoginBuckets).values({ adminKeyHash: bucketKey, attempts: 0, windowStartedAt: now }).onDuplicateKeyUpdate({ set: { adminKeyHash: bucketKey } });
    const [bucket] = await tx.select().from(s.platformAdminLoginBuckets).where(eq(s.platformAdminLoginBuckets.adminKeyHash, bucketKey)).for("update");
    if (bucket?.lockedUntil && bucket.lockedUntil > now) return false;
    const expired = !bucket || now.getTime() - bucket.windowStartedAt.getTime() >= ADMIN_LOGIN.windowMs;
    const passwordOk = await verifyAdminPassword(password, admin?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!passwordOk || !admin) {
      const attempts = (expired ? 0 : bucket?.attempts ?? 0) + 1;
      await tx.update(s.platformAdminLoginBuckets).set({
        attempts,
        windowStartedAt: expired ? now : bucket!.windowStartedAt,
        lockedUntil: attempts >= ADMIN_LOGIN.maxAttempts ? new Date(now.getTime() + ADMIN_LOGIN.windowMs) : null,
      }).where(eq(s.platformAdminLoginBuckets.adminKeyHash, bucketKey));
      return false;
    }
    await tx.update(s.platformAdminLoginBuckets).set({ attempts: 0, windowStartedAt: now, lockedUntil: null }).where(eq(s.platformAdminLoginBuckets.adminKeyHash, bucketKey));
    await tx.update(s.platformAdmins).set({ lastLoginAt: now }).where(eq(s.platformAdmins.id, admin.id));
    return true;
  });
  if (!valid || !admin) return false;
  const jar = await cookies();
  jar.set(COOKIE, tokenFor(admin.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600 });
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
