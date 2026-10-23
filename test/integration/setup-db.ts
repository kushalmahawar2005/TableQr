import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import path from "node:path";
import { dbConfig } from "@/db/config";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as schema from "@/db/schema";
import type { GuestContext } from "@/server/guest/context";
import { seedDemo, seedOtherTenant, seedPlatform, wipeAll } from "../../scripts/demo-data";

/** Fresh schema and demo data in the test database; returns ids for assertions */
export async function resetTestDb() {
  const config = dbConfig();
  if (config.database !== "tableqr_test") throw new Error(`Refusing to reset ${config.database}`);
  const conn = await mysql.createConnection({ ...config, charset: "utf8mb4", timezone: "Z", multipleStatements: false });
  const db = drizzle({ client: conn, schema, mode: "default" });
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  await wipeAll(db);
  const { adminId } = await seedPlatform(db);
  const demo = await seedDemo(db, { adminId, openAllDay: true });
  const other = await seedOtherTenant(db);
  return { conn, db, demo, other };
}

let verifiedGuestSequence = 0;

/** Attach an OTP-verified guest identity for tests that exercise post-verification ordering. */
export async function attachVerifiedTestGuest(db: Pick<typeof appDb, "insert" | "update">, ctx: GuestContext, name: string) {
  const id = uuidv7();
  const phone = `+919${String(++verifiedGuestSequence).padStart(9, "0")}`;
  await db.insert(schema.guests).values({ id, tenantId: ctx.tenantId, phone, name });
  await db.update(schema.participants).set({ guestId: id }).where(eq(schema.participants.id, ctx.participantId));
  return ctx;
}
