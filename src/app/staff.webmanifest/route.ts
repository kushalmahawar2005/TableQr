// The installable staff app (waiters first, and every other role): one icon on the phone that
// opens the console, which sends each person to their own screen after sign-in. Only staff pages
// link this manifest, so guest pages are never offered as an install.

export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      id: "/console",
      name: "TableQR Staff",
      short_name: "TableQR",
      description: "Orders, tables and bills for restaurant staff.",
      start_url: "/console",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#f3f1ec",
      theme_color: "#1f2937",
      icons: [
        { src: "/staff-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/staff-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/staff-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
