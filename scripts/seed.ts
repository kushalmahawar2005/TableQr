// Seeds the demo restaurant from the spec's running example: npm run db:seed
// Wipes every Tableeqr table first, so it refuses to run against a non-local database.
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { dbConfig } from "../src/db/config";
import * as schema from "../src/db/schema";
import { seedDemo, seedPlatform, wipeAll } from "./demo-data";

loadEnvConfig(process.cwd());

async function main() {
  const config = dbConfig();
  if (!["127.0.0.1", "localhost"].includes(config.host) && !process.argv.includes("--force")) {
    throw new Error(`Refusing to wipe and seed ${config.host}. Pass --force if you really mean it.`);
  }

  const conn = await mysql.createConnection({ ...config, charset: "utf8mb4", timezone: "Z" });
  const db = drizzle({ client: conn, schema, mode: "default" });

  await wipeAll(db);
  const { adminId } = await seedPlatform(db);
  const demo = await seedDemo(db, { adminId });
  await conn.end();

  const c = demo.counts;
  console.log(`Seeded Spice Route, Jaipur (SRJ01): ${c.tables} tables, ${c.categories} categories, ${c.items} items, ${c.staff} staff.`);
  console.log("Table 12 QR: /r/SRJ01/t/k7Qm  (join code 4821)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
