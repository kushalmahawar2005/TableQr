// The platform admin as an installable web app. It holds no data: sign-in still guards every screen.
export function GET() {
  return Response.json({
    name: "Tableeqr Admin",
    short_name: "Admin",
    description: "Run the Tableeqr platform",
    id: "/admin",
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    background_color: "#F4F2EC",
    theme_color: "#103B2C",
    icons: [
      { src: "/admin/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/admin/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/admin/app-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
