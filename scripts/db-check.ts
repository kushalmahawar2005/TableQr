// Verifies the database connection: npm run db:check
import { loadEnvConfig } from "@next/env";
import mysql from "mysql2/promise";
import { dbConfig } from "../src/db/config";

loadEnvConfig(process.cwd());

async function main() {
  const config = dbConfig();
  const conn = await mysql.createConnection({ ...config, connectTimeout: 10000 });
  const [rows] = await conn.query("SELECT VERSION() AS version, DATABASE() AS db");
  const { version, db } = (rows as { version: string; db: string }[])[0];
  console.log(`Connected to ${db} on ${config.host} (MySQL ${version})`);
  await conn.end();
}

main().catch((err: NodeJS.ErrnoException) => {
  console.error(`Connection failed: ${err.code ?? ""} ${err.message}`);
  process.exit(1);
});
