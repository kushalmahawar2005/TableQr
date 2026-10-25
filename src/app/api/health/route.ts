import { createHealthCheck } from "@/server/health";

// Public on purpose, for an external uptime monitor. It answers with a status and nothing else.
export const dynamic = "force-dynamic";

// The database is loaded inside the check: a missing or wrong database setting then reads as
// "unhealthy" (503) instead of failing this route with a 500.
const check = createHealthCheck(async () => {
  const { db } = await import("@/db");
  await db.$client.query({ sql: "SELECT 1", timeout: 2_500 });
});

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "X-Robots-Tag": "noindex",
};

export async function GET() {
  const health = await check();
  return Response.json(health, { status: health.status === "healthy" ? 200 : 503, headers });
}

export async function HEAD() {
  const health = await check();
  return new Response(null, { status: health.status === "healthy" ? 200 : 503, headers });
}
