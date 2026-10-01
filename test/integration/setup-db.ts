import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import path from "node:path";
import { dbConfig } from "@/db/config";
import * as schema from "@/db/schema";
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
