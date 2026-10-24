import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { staffAppIconUrl } from "@/lib/staff-app";

// The staff manifest is requested with the outlet code learned at sign-in. It contains only
// public restaurant branding; staff sessions and guest pages are never included in the response.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("outlet");
  const brand = await staffAppBrandForOutletCode(code);
  const name = brand?.name?.trim() || "TableQR Staff";
  const icon = (size: 180 | 192 | 512) => staffAppIconUrl(size, brand?.code);
  const icons = [
    ...(brand?.logoUrl ? [{ src: brand.logoUrl, sizes: "any", purpose: "any" }] : []),
    { src: icon(192), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: icon(512), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
  return Response.json(
    {
      id: brand ? `/console?outlet=${encodeURIComponent(brand.code)}` : "/console",
      name: brand ? `${name} Staff` : name,
      short_name: name.slice(0, 12),
      description: `Orders, tables and bills for ${name} staff.`,
      start_url: "/console",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#f3f1ec",
      theme_color: /^#[\da-f]{6}$/i.test(brand?.accentColor ?? "") ? brand!.accentColor : "#1f2937",
      icons,
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } },
  );
}
