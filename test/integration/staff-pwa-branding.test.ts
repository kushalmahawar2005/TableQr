import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { GET as staffManifest } from "@/app/staff.webmanifest/route";
import { staffAppMetadataFor, staffAppViewportFor } from "@/lib/staff-app";
import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;

beforeAll(async () => { env = await resetTestDb(); });
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("tenant-branded staff PWA", () => {
  it("uses only the requested outlet's public name, logo and validated accent in the install manifest", async () => {
    await env.db.update(s.outlets).set({ name: "BMW Jaipur", accentColor: "#c9482b" }).where(and(eq(s.outlets.tenantId, env.demo.tenantId), eq(s.outlets.id, env.demo.outletId)));
    await env.db.update(s.brands).set({ logoUrl: "/uploads/menus/bmw/logo.webp" }).where(and(eq(s.brands.tenantId, env.demo.tenantId), eq(s.brands.id, env.demo.brandId)));

    const brand = await staffAppBrandForOutletCode(env.demo.outletCode);
    expect(brand).toMatchObject({ code: env.demo.outletCode, name: "BMW Jaipur", logoUrl: "/uploads/menus/bmw/logo.webp", accentColor: "#c9482b" });

    const response = await staffManifest(new Request(`https://tableeqr.example/staff.webmanifest?outlet=${env.demo.outletCode}`));
    const manifest = await response.json();
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    expect(manifest).toMatchObject({
      id: `/console?outlet=${env.demo.outletCode}`,
      name: "BMW Jaipur Staff",
      short_name: "BMW Jaipur",
      start_url: "/console",
      scope: "/",
      display: "standalone",
      theme_color: "#c9482b",
    });
    expect(manifest.icons).toContainEqual({ src: "/uploads/menus/bmw/logo.webp", sizes: "any", purpose: "any" });
    expect(manifest.icons).toContainEqual({ src: `/staff-icon/512?outlet=${env.demo.outletCode}`, sizes: "512x512", type: "image/png", purpose: "maskable" });
  });

  it("does not expose another outlet or accept an invalid outlet code as branding", async () => {
    expect(await staffAppBrandForOutletCode("<script>alert(1)</script>")).toBeNull();
    const response = await staffManifest(new Request("https://tableeqr.example/staff.webmanifest?outlet=UNKNOWN"));
    const manifest = await response.json();
    expect(manifest.name).toBe("Tableeqr Staff");
    expect(manifest.icons.some((icon: { src: string }) => icon.src.includes("BMW"))).toBe(false);
  });

  it("sets safe tenant metadata and falls back when the stored color is malformed", () => {
    const brand = { code: "SRJ01", name: "Spice Route", logoUrl: "/uploads/logo.webp", accentColor: "red;url(javascript:alert(1))" };
    expect(staffAppMetadataFor(brand)).toMatchObject({
      manifest: "/staff.webmanifest?outlet=SRJ01",
      appleWebApp: { title: "Spice Route" },
      icons: { apple: "/uploads/logo.webp" },
    });
    expect(staffAppViewportFor(brand)).toEqual({ themeColor: "#1f2937" });
    expect(staffAppMetadataFor({ ...brand, code: "<svg" }).manifest).toBe("/staff.webmanifest");
  });
});
