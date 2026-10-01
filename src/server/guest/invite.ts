import "server-only";
import { encodeQr, qrSvgPath } from "@/domain/qr";

// The G7 invite: the table's own QR address, the same one printed on the table. It carries no
// participant id, session id or secret, so sharing it only ever leads to G1 for this table.

/** Public origin for links: PUBLIC_APP_URL when set, otherwise the address this page was asked for */
export function publicOrigin(h: Headers): string {
  const configured = process.env.PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export function tableInvite(origin: string, outletCode: string, shortCode: string) {
  const url = `${origin}/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}`;
  const qr = encodeQr(url);
  return { url, display: url.replace(/^https?:\/\//, ""), qrPath: qrSvgPath(qr), qrBox: qr.size + 8 };
}
