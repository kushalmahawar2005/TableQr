import { timingSafeEqual } from "node:crypto";
import { processBroadcastBatch } from "@/server/whatsapp/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Invoke once per minute with the existing service scheduler secret. */
export async function POST(request: Request) {
  const secret = process.env.SERVICE_TASK_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "Broadcast scheduler not configured" }, { status: 503 });
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await processBroadcastBatch();
    return Response.json(result, { status: result.errors ? 503 : 200 });
  } catch { return Response.json({ error: "Broadcast task could not finish; retry on the next scheduled run" }, { status: 503 }); }
}
