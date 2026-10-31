import "server-only";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { dbConfig, poolSizeFrom } from "./config";
import * as schema from "./schema";

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pool?: mysql.Pool };

const pool =
  globalForDb.pool ??
  mysql.createPool({
    ...dbConfig(),
    // Hosting counts connections across Node workers, so cap each worker at 12 and default to 10;
    // set DB_POOL_SIZE lower if this deployment has more workers (see poolSizeFrom)
    connectionLimit: poolSizeFrom(process.env.DB_POOL_SIZE),
    charset: "utf8mb4", // Hindi menu names
    timezone: "Z", // store and read every timestamp as UTC
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle({ client: pool, schema, mode: "default" });

/** The pool's size, for the start-up log that confirms which setting is live */
export const poolSize = poolSizeFrom(process.env.DB_POOL_SIZE);
