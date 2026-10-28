import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { AppError } from "../errors";

const setupError = () => new AppError("invalid_state", "WhatsApp connection is not configured yet. Ask Tableeqr to finish the setup.");
export function metaConfig() {
  const appId = process.env.WHATSAPP_APP_ID?.trim() ?? "";
  const secret = process.env.WHATSAPP_APP_SECRET?.trim() ?? "";
  const configId = process.env.WHATSAPP_SIGNUP_CONFIG_ID?.trim() ?? "";
  const version = process.env.WHATSAPP_GRAPH_VERSION?.trim() ?? "";
  if (!/^\d+$/.test(appId) || !secret || !/^\d+$/.test(configId) || !/^v\d+\.0$/.test(version)) throw setupError();
  return { appId, secret, configId, version };
}
function key() {
  const value = process.env.WHATSAPP_TOKEN_KEY?.trim() ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw setupError();
  return Buffer.from(value, "hex");
}
export function publicMetaConfig() {
  try { const { appId, configId, version } = metaConfig(); key(); return { appId, configId, version }; } catch { return null; }
}
export function sealWhatsAppToken(tenantId: string, token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`whatsapp:${tenantId}`));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(".");
}
export function openWhatsAppToken(tenantId: string, sealed: string) {
  try {
    const [version, iv, tag, data] = sealed.split(".");
    if (version !== "v1" || !/^[a-f0-9]{24}$/.test(iv) || !/^[a-f0-9]{32}$/.test(tag) || !/^(?:[a-f0-9]{2})+$/.test(data)) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
    cipher.setAAD(Buffer.from(`whatsapp:${tenantId}`));
    cipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([cipher.update(Buffer.from(data, "hex")), cipher.final()]).toString("utf8");
  } catch { throw new AppError("invalid_state", "Saved WhatsApp credentials cannot be unlocked. Ask Tableeqr for help."); }
}

/** Fixed Graph origin, bounded timeout, no arbitrary pagination URLs and no raw provider errors. */
export async function metaRequest<T>(path: string, token: string | null, options: { method?: "GET" | "POST"; params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const { secret, version } = metaConfig();
  if (!/^[a-zA-Z0-9_/-]+$/.test(path)) throw new AppError("invalid_state", "Invalid WhatsApp request.");
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [name, value] of Object.entries(options.params ?? {})) url.searchParams.set(name, value);
  if (token) url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(token).digest("hex"));
  let response: Response;
  try {
    response = await fetch(url, { method: options.method ?? "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  } catch { throw new AppError("invalid_state", "WhatsApp could not be reached. Please try again."); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    const code = Number(data?.error?.code);
    throw new AppError("invalid_state", code === 190 ? "WhatsApp authorization expired. Connect the account again." : `WhatsApp could not complete this request${Number.isFinite(code) ? ` (code ${code})` : ""}. Check the account in Meta Business Manager and retry.`);
  }
  return data as T;
}

export async function exchangeSignupCode(code: string) {
  if (!code || code.length > 4096) throw new AppError("invalid_state", "WhatsApp signup was not completed. Try connecting again.");
  const { appId, secret } = metaConfig();
  const data = await metaRequest<{ access_token: string }>("oauth/access_token", null, { method: "POST", body: { client_id: appId, client_secret: secret, code } });
  if (typeof data.access_token !== "string" || !data.access_token) throw new AppError("invalid_state", "WhatsApp did not return authorization. Try connecting again.");
  return data.access_token;
}
