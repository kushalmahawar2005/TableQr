import { staffAppIconUrl } from "./staff-app";

/** Use the restaurant's uploaded logo as the installed guest app icon when it exists. */
export function restaurantAppIcons(code: string, logoUrl: string | null) {
  if (logoUrl) {
    // Android needs real PNG sizes from this site, so the logo is served through the app-icon route
    const icon = `/r/${encodeURIComponent(code)}/app-icon`;
    return [
      { src: `${icon}/192`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${icon}/512`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${icon}/512?maskable=1`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ];
  }

  // Keep the restaurant-specific initials as a useful fallback when no logo was uploaded.
  return [
    { src: staffAppIconUrl(192, code), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: staffAppIconUrl(512, code), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
}
