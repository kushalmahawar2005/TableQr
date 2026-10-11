import { loadEnvConfig } from "@next/env";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as s from "../src/db/schema";
import { uuidv7 } from "../src/db/id";
import { dbConfig } from "../src/db/config";
import { hashAdminPassword } from "../src/server/admin/password";
import { eq } from "drizzle-orm";

async function main() {
  loadEnvConfig(process.cwd());
  const pool = mysql.createPool({ ...dbConfig(), connectionLimit: 2, charset: "utf8mb4", timezone: "Z" });
  const db = drizzle({ client: pool, schema: s, mode: "default" });

  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.PLATFORM_ADMIN_NAME?.trim();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !name || !password) throw new Error("Set PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME and PLATFORM_ADMIN_PASSWORD");

  const plans = [
    { code: "starter", name: "Starter", monthlyPricePaise: 99900, sortOrder: 0, features: { maxTables: 15, maxStaff: 3, bookings: "reservations_only" as const, groupSplit: false, pricingRules: false, suggestions: false, guestCampaigns: false, multiOutlet: false, poweredBy: true, kitchenDisplay: false } },
    { code: "growth", name: "Growth", monthlyPricePaise: 249900, sortOrder: 1, features: { maxTables: 40, maxStaff: 10, bookings: "full" as const, groupSplit: true, pricingRules: false, suggestions: false, guestCampaigns: false, multiOutlet: false, poweredBy: true, kitchenDisplay: false } },
    { code: "pro", name: "Pro", monthlyPricePaise: 499900, sortOrder: 2, features: { maxTables: 80, maxStaff: 25, bookings: "full" as const, groupSplit: true, pricingRules: true, suggestions: true, guestCampaigns: true, multiOutlet: false, poweredBy: false, kitchenDisplay: true } },
    { code: "chain", name: "Chain", monthlyPricePaise: null, sortOrder: 3, features: { maxTables: null, maxStaff: null, bookings: "full" as const, groupSplit: true, pricingRules: true, suggestions: true, guestCampaigns: true, multiOutlet: true, poweredBy: false, kitchenDisplay: true } },
  ];

  for (const plan of plans) {
    const [existing] = await db.select({ code: s.plans.code }).from(s.plans).where(eq(s.plans.code, plan.code));
    if (!existing) await db.insert(s.plans).values(plan);
  }

  const [existing] = await db.select({ id: s.platformAdmins.id }).from(s.platformAdmins).where(eq(s.platformAdmins.email, email));
  const passwordHash = await hashAdminPassword(password);
  if (existing) {
    await db.update(s.platformAdmins).set({ name, passwordHash, role: "super_admin", isActive: true }).where(eq(s.platformAdmins.id, existing.id));
  } else {
    await db.insert(s.platformAdmins).values({ id: uuidv7(), email, name, passwordHash, role: "super_admin" });
  }
  console.log(`Platform admin ready: ${email}`);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
