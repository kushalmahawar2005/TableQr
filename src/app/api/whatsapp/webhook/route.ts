import { timingSafeEqual } from "node:crypto";
import { processWhatsAppWebhook, verifyWhatsAppSignature } from "@/server/whatsapp/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameSecret(actual: string | null, expected: string) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "";
  if (url.searchParams.get("hub.mode") !== "subscribe" || !sameSecret(url.searchParams.get("hub.verify_token"), verifyToken)) return new Response("Forbidden", { status: 403 });
  const challenge = url.searchParams.get("hub.challenge");
  if (!challenge || challenge.length > 256) return new Response("Bad request", { status: 400 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 1_000_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 1_000_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  if (!verifyWhatsAppSignature(raw, request.headers.get("x-hub-signature-256"))) return Response.json({ error: "Invalid signature" }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  try { return Response.json(await processWhatsAppWebhook(payload), { status: 200 }); }
  catch { return Response.json({ error: "Webhook processing failed; retry delivery" }, { status: 503 }); }
}
