import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { staffAppIconUrl } from "@/lib/staff-app";

// The staff manifest is requested with the outlet code learned at sign-in. It contains only
// public restaurant branding; staff sessions and guest pages are never included in the response.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("outlet");
  // Each app only claims its own pages, so a guest link or the admin opened from WhatsApp
  // opens in the browser, never inside an installed staff app.
  const home = params.get("app") === "waiter" ? "/waiter" : "/console";
  const brand = await staffAppBrandForOutletCode(code);
  const name = brand?.name?.trim() || "Tableeqr Staff";
  const icon = (size: 180 | 192 | 512) => staffAppIconUrl(size, brand?.code);
  const icons = [
    ...(brand?.logoUrl ? [{ src: brand.logoUrl, sizes: "any", purpose: "any" }] : []),
    { src: icon(192), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: icon(512), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
  return Response.json(
    {
      id: brand ? `${home}?outlet=${encodeURIComponent(brand.code)}` : home,
      name: brand ? `${name} Staff` : name,
      short_name: name.slice(0, 12),
      description: `Orders, tables and bills for ${name} staff.`,
      start_url: home,
      scope: home,
      display: "standalone",
      orientation: "portrait",
      background_color: "#f3f1ec",
      theme_color: /^#[\da-f]{6}$/i.test(brand?.accentColor ?? "") ? brand!.accentColor : "#1f2937",
      icons,
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } },
  );
}
