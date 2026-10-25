// Connection settings shared by the app, drizzle-kit and scripts.
export function dbConfig() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    throw new Error(
      "Database is not configured. Set DB_HOST, DB_NAME, DB_USER and DB_PASSWORD in .env.local",
    );
  }
  return {
    host: DB_HOST,
    port: Number(DB_PORT ?? 3306),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  };
}

/** Most connections the app will ever open: the host allows 75 per user, and tools and deploys need some */
export const MAX_POOL_SIZE = 40;
export const DEFAULT_POOL_SIZE = 10;

/** `DB_POOL_SIZE` as a whole number from 1 to 40; anything else (empty, text, zero) is the default of 10 */
export function poolSizeFrom(value: string | undefined): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_POOL_SIZE;
  return Math.min(n, MAX_POOL_SIZE);
}
