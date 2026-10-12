import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { hashAdminPassword, verifyAdminPassword } from "./password";

// The platform admin from the hosting panel's environment (PLATFORM_ADMIN_EMAIL / _NAME /
// _PASSWORD) is written to the database at every server start, so changing it there and
// restarting is enough: no SSH and no script. The password is only re-hashed when it changed.

export async function ensurePlatformAdmin(env: Record<string, string | undefined> = process.env): Promise<"none" | "ok" | "updated" | "created" | "short_password"> {
  const email = env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.PLATFORM_ADMIN_PASSWORD;
  const name = env.PLATFORM_ADMIN_NAME?.trim() || "Admin";
  if (!email || !password) return "none";
  if (password.length < 12) return "short_password";
  const [admin] = await db.select().from(s.platformAdmins).where(eq(s.platformAdmins.email, email));
  if (admin && admin.isActive && admin.role === "super_admin" && admin.name === name && (await verifyAdminPassword(password, admin.passwordHash))) return "ok";
  const passwordHash = await hashAdminPassword(password);
  if (admin) {
    await db.update(s.platformAdmins).set({ name, passwordHash, role: "super_admin", isActive: true }).where(eq(s.platformAdmins.id, admin.id));
    return "updated";
  }
  await db.insert(s.platformAdmins).values({ id: uuidv7(), email, name, passwordHash, role: "super_admin" });
  return "created";
}
