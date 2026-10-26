import { describe, expect, it } from "vitest";
import { menuThumb } from "./menu-photo";

describe("menuThumb", () => {
  it("points stored menu photos at their small copy and leaves anything else alone", () => {
    expect(menuThumb("/uploads/menus/t/b/abc.webp")).toBe("/uploads/menus/t/b/abc-sm.webp");
    expect(menuThumb("https://cdn.example.com/bucket/menus/t/b/abc.webp")).toBe("https://cdn.example.com/bucket/menus/t/b/abc-sm.webp");
    expect(menuThumb("/uploads/menus/t/b/abc-sm.webp")).toBe("/uploads/menus/t/b/abc-sm.webp");
    expect(menuThumb("https://cdn.example.com/library/dal-makhani.f8758e58.webp")).toBe("https://cdn.example.com/library/dal-makhani.f8758e58-sm.webp");
    expect(menuThumb("https://example.com/photo.jpg")).toBe("https://example.com/photo.jpg");
    expect(menuThumb(null)).toBeNull();
  });
});
