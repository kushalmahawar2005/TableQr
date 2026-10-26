import { staffAppIconUrl } from "@/lib/staff-app";
import { restaurantApp } from "@/server/guest/restaurant-app";

// The restaurant's own app manifest: public branding only, and only on plans with delivery or reservations
export async function GET(_req: Request, ctx: RouteContext<"/r/[outlet]/app.webmanifest">) {
  const app = await restaurantApp((await ctx.params).outlet);
  if (!app) return new Response("Not found", { status: 404 });
  const start = `/r/${encodeURIComponent(app.code)}`;
  return Response.json({
    id: start,
    name: app.name,
    short_name: app.name.slice(0, 12),
    description: `Order and book a table at ${app.name}.`,
    start_url: start,
    scope: start,
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4ef",
    theme_color: /^#[\da-f]{6}$/i.test(app.accentColor ?? "") ? app.accentColor : "#c9482b",
    icons: [
      { src: staffAppIconUrl(192, app.code), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: staffAppIconUrl(512, app.code), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } });
}
