import { existsSync } from "node:fs";
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
    expect((await sharp(full).metadata()).width).toBe(1600);
    expect((await sharp(small).metadata()).width).toBe(480);
    await removeLocalMenuImage(res.url);
    expect(existsSync(full) || existsSync(small)).toBe(false);
    stored = null;
  });
});
