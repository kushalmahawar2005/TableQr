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

/** Which installed app: the owner console or the waiter app. Each keeps to its own pages. */
export type StaffAppKind = "console" | "waiter";

/** Head tags for the installable staff app, branded for the outlet saved at sign-in. */
export function staffAppMetadataFor(brand: StaffAppBrand | null, app: StaffAppKind = "console"): Pick<Metadata, "manifest" | "appleWebApp" | "icons"> {
  const code = safeCode(brand?.code);
  const query = new URLSearchParams({ ...(code ? { outlet: code } : {}), ...(app === "waiter" ? { app } : {}) }).toString();
  const manifest = `/staff.webmanifest${query ? `?${query}` : ""}`;
  return {
    manifest,
    appleWebApp: { capable: true, title: (brand?.name || "Tableeqr").trim().slice(0, 16), statusBarStyle: "default" },
    icons: { apple: brand?.logoUrl || staffAppIconUrl(180, code) },
  };
}

export function staffAppViewportFor(brand: StaffAppBrand | null): Viewport {
  const accent = brand?.accentColor ?? "";
  return { themeColor: /^#[\da-f]{6}$/i.test(accent) ? accent : FALLBACK_COLOR };
}
