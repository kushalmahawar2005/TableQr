import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { ensurePlatformAdmin } from "@/server/admin/ensure-admin";
import { verifyAdminPassword } from "@/server/admin/password";
import { resetTestDb } from "./setup-db";

// The admin sign-in set in the hosting panel reaches the database at server start.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const row = async (email: string) => (await env.db.select().from(s.platformAdmins).where(eq(s.platformAdmins.email, email)))[0];

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("platform admin from the environment", () => {
  it("creates the admin, then changes the password when the panel changes it", async () => {
    const base = { PLATFORM_ADMIN_EMAIL: "Owner@Example.com ", PLATFORM_ADMIN_NAME: "Owner", PLATFORM_ADMIN_PASSWORD: "first-password-123" };
    expect(await ensurePlatformAdmin(base)).toBe("created");
    expect(await ensurePlatformAdmin(base)).toBe("ok");
    expect(await ensurePlatformAdmin({ ...base, PLATFORM_ADMIN_PASSWORD: "second-password-456" })).toBe("updated");
    const admin = await row("owner@example.com");
    expect(await verifyAdminPassword("second-password-456", admin.passwordHash)).toBe(true);
    expect(await verifyAdminPassword("first-password-123", admin.passwordHash)).toBe(false);
  });

  it("refuses a short password and does nothing without settings", async () => {
    expect(await ensurePlatformAdmin({ PLATFORM_ADMIN_EMAIL: "a@b.co", PLATFORM_ADMIN_PASSWORD: "short" })).toBe("short_password");
    expect(await row("a@b.co")).toBeUndefined();
    expect(await ensurePlatformAdmin({})).toBe("none");
  });
});
