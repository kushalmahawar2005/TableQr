// Runs once when a server instance starts, before it takes requests: bring the database up to what
// this release needs (see src/server/ensure-schema.ts). A failure is logged, never fatal, so a
// database hiccup at boot does not keep the site down.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const [{ db }, { ensureSchema }] = await Promise.all([import("@/db"), import("@/server/ensure-schema")]);
    await ensureSchema(db.$client);
  } catch (err) {
    console.error("[schema] could not update the database at startup", err);
  }
}
