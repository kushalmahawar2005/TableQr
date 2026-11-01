import sharp from "sharp";
import { restaurantApp } from "@/server/guest/restaurant-app";

// The installed app's icon, made from the restaurant's logo: a square PNG from this site at the exact
// size Android asks for, whatever format the logo was uploaded in. The maskable one keeps the logo
// inside the middle 80%, so a round or squircle home-screen shape never cuts it.

const SIZES = new Set([192, 512]);
const MAX_LOGO_BYTES = 6 * 1024 * 1024;

export async function GET(req: Request, ctx: RouteContext<"/r/[outlet]/app-icon/[size]">) {
  const { outlet, size: sizeText } = await ctx.params;
  const size = Number(sizeText);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const app = await restaurantApp(outlet);
  if (!app?.logoUrl) return new Response("Not found", { status: 404 });
  const logo = await fetch(new URL(app.logoUrl, req.url), { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!logo?.ok) return new Response("Logo unavailable", { status: 502 });
  const bytes = Buffer.from(await logo.arrayBuffer());
  if (bytes.length > MAX_LOGO_BYTES) return new Response("Logo too large", { status: 502 });
  const maskable = new URL(req.url).searchParams.has("maskable");
  const inner = maskable ? Math.round(size * 0.8) : size;
  const edge = Math.floor((size - inner) / 2);
  const png = await sharp(bytes)
    .resize(inner, inner, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .extend({ top: edge, bottom: size - inner - edge, left: edge, right: size - inner - edge, background: "#ffffff" })
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
