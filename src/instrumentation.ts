import type { Instrumentation } from "next";

// Next waits for register() before accepting requests. Do not let a server run against a partial
// schema: startup migrations are repeatable, so the process manager can safely restart and retry.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const [{ db, poolSize }, { ensureSchema }] = await Promise.all([import("@/db"), import("@/server/ensure-schema")]);
    console.log(`[db] connection pool size ${poolSize}`);
    await ensureSchema(db.$client);
  } catch (err) {
    const value = err && typeof err === "object" ? err as { name?: unknown; code?: unknown; errno?: unknown; sqlState?: unknown } : {};
    const details = {
      errorName: typeof value.name === "string" ? value.name.slice(0, 80) : "UnknownError",
      ...(typeof value.code === "string" && /^[A-Z0-9_]{1,40}$/.test(value.code) ? { errorCode: value.code } : {}),
      ...(typeof value.errno === "number" ? { errorNumber: value.errno } : {}),
      ...(typeof value.sqlState === "string" && /^[A-Z0-9]{5}$/.test(value.sqlState) ? { sqlState: value.sqlState } : {}),
    };
    console.error("[schema] startup migration failed; server is not ready", details);
    throw new Error("Database schema initialization failed; server cannot accept traffic");
  }
  // The admin sign-in from the hosting panel's environment
  try {
    const { ensurePlatformAdmin } = await import("@/server/admin/ensure-admin");
    const res = await ensurePlatformAdmin();
    if (res === "short_password") console.error("[admin] PLATFORM_ADMIN_PASSWORD must be at least 12 characters; the admin was not updated");
    else if (res === "created" || res === "updated") console.log(`[admin] platform admin ${res} from the environment`);
  } catch (err) {
    console.error("[admin] could not set up the platform admin", err);
  }
  // Photos still on this machine go to the photo bucket once one is set up (R2); in the background
  void (async () => {
    try {
      const [{ db }, { movePhotosToBucket }] = await Promise.all([import("@/db"), import("@/server/menu-storage")]);
      const res = await movePhotosToBucket(db.$client);
      if (res.moved || res.missing) console.log(`[photos] moved ${res.moved} to the bucket; ${res.missing} files were already gone`);
    } catch (err) {
      console.error("[photos] could not move photos to the bucket", err);
    }
  })();
}

/**
 * Keep enough detail to match a production error to its route and database error code without
 * logging request URLs, headers, SQL, or bound values (which may contain tenant data or tokens).
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const details: Record<string, string | number> = {
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource ?? "unknown",
  };
  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (depth === 0 && typeof value.digest === "string") details.digest = value.digest.slice(0, 100);
    if (!details.errorName && typeof value.name === "string") details.errorName = value.name.slice(0, 80);
    if (!details.errorCode && typeof value.code === "string" && /^[A-Z0-9_]{1,40}$/.test(value.code)) details.errorCode = value.code;
    if (!details.errorNumber && typeof value.errno === "number") details.errorNumber = value.errno;
    if (!details.sqlState && typeof value.sqlState === "string" && /^[A-Z0-9]{5}$/.test(value.sqlState)) details.sqlState = value.sqlState;
    current = value.cause;
  }

  console.error("[request-error]", JSON.stringify(details));
};
