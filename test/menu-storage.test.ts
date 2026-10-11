import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { removeLocalMenuImage, storeMenuImage } from "@/server/menu-storage";

// Uploaded menu photos are kept twice: full size for the dish sheet, and a small copy for lists.

let stored: string | null = null;
afterAll(async () => {
  await removeLocalMenuImage(stored);
});

describe("menu photo upload", () => {
  it("saves the full photo and a 480 px copy beside it", async () => {
    process.env.MENU_STORAGE_DRIVER = "local";
    const bytes = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#c9482b" } }).jpeg().toBuffer();
    const res = await storeMenuImage({ tenantId: "t-test", brandId: "b-test", filename: "x.jpg", contentType: "image/jpeg", bytes });
    stored = res.url;
    const full = path.join(process.cwd(), "public", res.url);
    const small = full.replace(/\.webp$/, "-sm.webp");
    expect(existsSync(full) && existsSync(small)).toBe(true);
    expect((await sharp(full).metadata()).width).toBe(1400);
    expect((await sharp(small).metadata()).width).toBe(480);
    await removeLocalMenuImage(res.url);
    expect(existsSync(full) || existsSync(small)).toBe(false);
    stored = null;
  });

  it("shrinks a big, busy phone photo to about 100 KB, and its list copy to about 30 KB", async () => {
    process.env.MENU_STORAGE_DRIVER = "local";
    const bytes = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#b5651d", noise: { type: "gaussian", mean: 120, sigma: 50 } } }).blur(1.2).jpeg({ quality: 92 }).toBuffer();
    expect(bytes.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    const res = await storeMenuImage({ tenantId: "t-test", brandId: "b-test", filename: "big.jpg", contentType: "image/jpeg", bytes });
    stored = res.url;
    const full = path.join(process.cwd(), "public", res.url);
    const { size: fullBytes } = await stat(full);
    const { size: smallBytes } = await stat(full.replace(/\.webp$/, "-sm.webp"));
    expect(fullBytes).toBeLessThanOrEqual(100 * 1024);
    expect(smallBytes).toBeLessThanOrEqual(30 * 1024);
    expect((await sharp(full).metadata()).width).toBeGreaterThanOrEqual(800);
    await removeLocalMenuImage(res.url);
    stored = null;
  }, 30_000);
});
