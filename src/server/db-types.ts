import type { db } from "@/db";

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run a query: the pool or an open transaction */
export type Runner = Db | Tx;

/**
 * For transactions that take a row lock and then read. Under MySQL's default REPEATABLE READ,
 * a read made before the lock fixes the snapshot, so rows committed by the transaction we
 * waited on stay invisible. READ COMMITTED makes every read after the lock see them.
 */
export const LOCK_THEN_READ = { isolationLevel: "read committed" } as const;
