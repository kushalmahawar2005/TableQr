import type { Metadata, Viewport } from "next";

export type StaffAppBrand = { code: string; name: string; logoUrl: string | null; accentColor: string | null };

const FALLBACK_COLOR = "#1f2937";

function safeCode(value: string | null | undefined) {
  const code = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{2,12}$/.test(code) ? code : "";
}

export function staffAppIconUrl(size: 180 | 192 | 512, outletCode?: string | null) {
  const code = safeCode(outletCode);
  return `/staff-icon/${size}${code ? `?outlet=${encodeURIComponent(code)}` : ""}`;
}

/** Head tags for the installable staff app, branded for the outlet saved at sign-in. */
export function staffAppMetadataFor(brand: StaffAppBrand | null): Pick<Metadata, "manifest" | "appleWebApp" | "icons"> {
  const code = safeCode(brand?.code);
  const manifest = `/staff.webmanifest${code ? `?outlet=${encodeURIComponent(code)}` : ""}`;
  return {
    manifest,
    appleWebApp: { capable: true, title: (brand?.name || "TableQR").trim().slice(0, 16), statusBarStyle: "default" },
    icons: { apple: brand?.logoUrl || staffAppIconUrl(180, code) },
  };
}

export function staffAppViewportFor(brand: StaffAppBrand | null): Viewport {
  const accent = brand?.accentColor ?? "";
  return { themeColor: /^#[\da-f]{6}$/i.test(accent) ? accent : FALLBACK_COLOR };
}
