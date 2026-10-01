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
