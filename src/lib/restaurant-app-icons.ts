import { staffAppIconUrl } from "./staff-app";

/** Use the restaurant's uploaded logo as the installed guest app icon when it exists. */
export function restaurantAppIcons(code: string, logoUrl: string | null) {
  if (logoUrl) {
    // A saved restaurant logo is already a square 512 px image. Declare it as scalable and
    // maskable so Chrome can use it for both the install dialog and the home-screen icon.
    return [{ src: logoUrl, sizes: "any", purpose: "any maskable" }];
  }

  // Keep the restaurant-specific initials as a useful fallback when no logo was uploaded.
  return [
    { src: staffAppIconUrl(192, code), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: staffAppIconUrl(512, code), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
}
