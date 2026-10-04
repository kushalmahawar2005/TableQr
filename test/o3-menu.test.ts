import { describe, expect, it } from "vitest";
import { parseMenuCsv, parseMenuFile } from "@/server/staff/menu-import";
import { storeMenuImage } from "@/server/menu-storage";
import * as XLSX from "xlsx";
import sharp from "sharp";
import { unlink } from "node:fs/promises";

describe("O3 menu manager import validation", () => {
  it("parses the documented atomic CSV columns and preserves nullable allergens", () => {
    const rows = parseMenuCsv("category,english name,hindi name,price,veg,jain,spice,allergens,station,prep minutes,aliases,bestseller\nStarters,Paneer Tikka,पनीर टिक्का,320,true,false,2,dairy|gluten,Tandoor,15,panir,true");
    expect(rows[0]).toMatchObject({ nameEn: "Paneer Tikka", nameHi: "पनीर टिक्का", price: 320, allergens: ["dairy", "gluten"] });
  });
  it("rejects a blocking row before any commit can be attempted", () => {
    expect(() => parseMenuCsv("category,english name,price,station,prep minutes\nStarters,,320,Tandoor,15")).toThrow(/row 2/i);
  });
  it("rejects missing required headers", () => {
    expect(() => parseMenuCsv("name,price\nPaneer,320")).toThrow(/requires/i);
  });
  it("parses XLSX through the server-side spreadsheet adapter", async () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["category", "english name", "price", "station", "prep minutes"], ["Mains", "Test Curry", 210, "Main", 12]]);
    XLSX.utils.book_append_sheet(book, sheet, "Menu");
    const rows = await parseMenuFile("menu.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
    expect(rows[0].nameEn).toBe("Test Curry");
  });
  it("rejects malformed spreadsheet input", async () => {
    await expect(parseMenuFile("menu.xlsx", Buffer.from("not an xlsx"))).rejects.toThrow();
  });
  it("rejects unsafe image MIME types and oversized files before storage", async () => {
    await expect(storeMenuImage({ tenantId: "t", brandId: "b", filename: "x.svg", contentType: "image/svg+xml", bytes: Buffer.from("x") })).rejects.toThrow(/JPG/);
    await expect(storeMenuImage({ tenantId: "t", brandId: "b", filename: "x.jpg", contentType: "image/jpeg", bytes: Buffer.alloc(5 * 1024 * 1024 + 1) })).rejects.toThrow(/5 MB/);
  });
  it("writes a resized WebP through the explicit local adapter", async () => {
    process.env.MENU_STORAGE_DRIVER = "local";
    const result = await storeMenuImage({ tenantId: "o3-test", brandId: "brand", filename: "x.png", contentType: "image/png", bytes: await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer() });
    expect(result.url).toMatch(/^\/uploads\/menus\//);
    await unlink(`${process.cwd()}/public${result.url}`);
  });
});

describe("O3 menu manager safety contracts", () => {
  it("exposes editable modifier, pairing, category, import, and price controls", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile("src/app/(console)/console/(app)/menu/_components/menu-manager.tsx", "utf8"));
    expect(source).toContain("Option English");
    expect(source).toContain("Save group order");
    expect(source).toContain("Clear time window / all day");
    expect(source).toContain("Commit atomically");
    expect(source).toContain("Bulk price · Owner only");
  });
  it("keeps manager price changes forbidden server-side", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile("src/server/staff/menu-manager.ts", "utf8"));
    expect(source).toContain("Managers cannot edit prices.");
    expect(source).toContain("Only an owner can change prices.");
  });
});

describe("phone and tablet width", () => {
  it("the three-column grid lets its children shrink, so the 650px item table scrolls inside its own box", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/app/(console)/console/(app)/menu/_components/menu-manager.tsx", import.meta.url), "utf8");
    expect(src).toContain("lg:grid-cols-[190px_minmax(0,1fr)_minmax(320px,430px)] [&>*]:min-w-0");
    expect(src).toContain("overflow-x-auto");
  });
});
