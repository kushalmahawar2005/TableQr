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
