import "server-only";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { dbConfig } from "./config";
import * as schema from "./schema";

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pool?: mysql.Pool };

const pool =
  globalForDb.pool ??
  mysql.createPool({
    ...dbConfig(),
    // Shared hosting caps MySQL connections, so 10 by default; raise DB_POOL_SIZE on a VPS
    connectionLimit: Math.max(1, Number(process.env.DB_POOL_SIZE) || 10),
    charset: "utf8mb4", // Hindi menu names
    timezone: "Z", // store and read every timestamp as UTC
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle({ client: pool, schema, mode: "default" });
