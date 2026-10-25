// The health check behind /api/health: is the app up and is its database answering? It reports
// only "healthy" or "unhealthy", never a connection string, user name or database error.

export type Health = { status: "healthy" | "unhealthy"; database: "connected" | "unavailable" };

/** The database gets this long to answer before the check calls it unavailable */
export const HEALTH_TIMEOUT_MS = 3_000;
/** A healthy answer is reused this long, so a monitor or a crowd cannot hammer the database */
export const HEALTH_CACHE_MS = 5_000;
/** An unhealthy answer is reused briefly, so recovery shows within seconds */
export const HEALTH_FAILURE_CACHE_MS = 2_000;

/**
 * Builds the check around `ping`, one lightweight read-only call to the database. Checks that
 * arrive while one is running share it, and a fresh answer is reused, so at most one ping runs at
 * a time on this server and the shared connection pool is never crowded out by monitoring.
 */
export function createHealthCheck(
  ping: () => Promise<unknown>,
  options: { timeoutMs?: number; cacheMs?: number; failureCacheMs?: number; now?: () => number } = {},
) {
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? HEALTH_CACHE_MS;
  const failureCacheMs = options.failureCacheMs ?? HEALTH_FAILURE_CACHE_MS;
  const now = options.now ?? Date.now;
  let cached: { health: Health; until: number } | null = null;
  let running: Promise<Health> | null = null;

  const run = async (): Promise<Health> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ping(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
      ]);
      return { status: "healthy", database: "connected" };
    } catch (error) {
      // Only the error's short code goes to the log: never its message, which can hold SQL or hosts
      const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code).slice(0, 40) : (error as Error)?.message === "timeout" ? "TIMEOUT" : "UNKNOWN";
      console.error(`[health] database check failed (${code})`);
      return { status: "unhealthy", database: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  };

  return async function check(): Promise<Health> {
    if (cached && cached.until > now()) return cached.health;
    running ??= run().then((health) => {
      cached = { health, until: now() + (health.status === "healthy" ? cacheMs : failureCacheMs) };
      return health;
    }).finally(() => { running = null; });
    return running;
  };
}
