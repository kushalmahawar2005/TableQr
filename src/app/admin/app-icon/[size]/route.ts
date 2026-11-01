import sharp from "sharp";

// The admin app's icon: a white T on forest green. The T stays inside the middle 60%, so a round
// or squircle home-screen shape never cuts it.

const SIZES = new Set([192, 512]);

export async function GET(_req: Request, ctx: RouteContext<"/admin/app-icon/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" fill="#103B2C"/><rect x="28" y="30" width="44" height="11" rx="2" fill="#fff"/><rect x="44.5" y="30" width="11" height="42" rx="2" fill="#fff"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
