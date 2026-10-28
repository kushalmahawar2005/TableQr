import "server-only";
import { createHmac } from "node:crypto";
import { metaConfig } from "./meta";

export type WhatsAppSendResult = { kind: "accepted"; messageId: string } | { kind: "rejected"; code: string; fatal: boolean; throttled: boolean } | { kind: "unknown" };
/** Never retry a timed-out message: Meta may have accepted it before the connection broke. */
export async function sendWhatsAppTemplate(phoneNumberId: string, token: string, payload: unknown): Promise<WhatsAppSendResult> {
  const { version, secret } = metaConfig();
  if (!/^\d+$/.test(phoneNumberId)) throw new Error("Invalid WhatsApp phone number id");
  const url = new URL(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`);
  url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(token).digest("hex"));
  try {
    const response = await fetch(url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => null);
    const messageId = data?.messages?.[0]?.id;
    if (response.ok && typeof messageId === "string" && messageId.length > 0 && messageId.length <= 80) return { kind: "accepted", messageId };
    // Explicit Graph client errors prove rejection; 5xx, malformed and missing replies do not.
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && typeof data?.error?.code === "number") {
      const code = data.error.code;
      return { kind: "rejected", code: String(code), fatal: [190, 10, 200, 132001, 132015, 132016].includes(code), throttled: response.status === 429 || [4, 80007, 130429, 131048, 131056].includes(code) };
    }
    return { kind: "unknown" };
  } catch { return { kind: "unknown" }; }
}

/** One-time, best-effort acknowledgement after a STOP opt-out has been committed locally. */
export async function sendOptOutAcknowledgement(phoneNumberId: string, token: string, to: string) {
  const { version, secret } = metaConfig();
  const url = new URL(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`);
  url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(token).digest("hex"));
  try {
    await fetch(url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: "You have been opted out of marketing messages from this restaurant." } }) });
  } catch { /* The opt-out is already committed; do not risk replying more than once. */ }
}
