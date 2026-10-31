import { restaurantAppIcons } from "@/lib/restaurant-app-icons";
import { restaurantApp } from "@/server/guest/restaurant-app";

// The restaurant's own app manifest: public branding only, and only on plans with delivery or reservations
export async function GET(_req: Request, ctx: RouteContext<"/r/[outlet]/app.webmanifest">) {
  const app = await restaurantApp((await ctx.params).outlet);
  if (!app) return new Response("Not found", { status: 404 });
  const home = `/r/${encodeURIComponent(app.code)}`;
  // The app opens and stays under /r/CODE/app (reservations, delivery, waitlist). Table QRs live at
  // /r/CODE/t/..., outside this scope, so a guest scanning at a table stays in the browser.
  const start = `${home}/app`;
  return Response.json({
    // Same identity as before the scope moved, so phones that already installed it get the update
    id: home,
    name: app.name,
    short_name: app.name.slice(0, 12),
    description: `Order and book a table at ${app.name}.`,
    start_url: start,
    scope: start,
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4ef",
    theme_color: /^#[\da-f]{6}$/i.test(app.accentColor ?? "") ? app.accentColor : "#c9482b",
    icons: restaurantAppIcons(app.code, app.logoUrl),
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } });
}
