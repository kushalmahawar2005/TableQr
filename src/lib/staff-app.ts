import type { Metadata, Viewport } from "next";

/** Head tags that make a staff page installable as the TableQR Staff app (see /staff.webmanifest) */
export const staffAppMetadata: Pick<Metadata, "manifest" | "appleWebApp" | "icons"> = {
  manifest: "/staff.webmanifest",
  appleWebApp: { capable: true, title: "TableQR", statusBarStyle: "default" },
  icons: { apple: "/staff-icon/180" },
};

export const staffAppViewport: Viewport = { themeColor: "#1f2937" };
