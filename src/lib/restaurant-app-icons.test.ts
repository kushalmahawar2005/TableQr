import { describe, expect, it } from "vitest";
import { restaurantAppIcons } from "./restaurant-app-icons";

describe("restaurant guest app icons", () => {
  it("uses the restaurant logo for installable icon purposes instead of a generic fallback", () => {
    expect(restaurantAppIcons("FIT01", "https://cdn.example.com/fit-bowl.webp")).toEqual([
      { src: "/r/FIT01/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/r/FIT01/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/r/FIT01/app-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("falls back to icons generated from the restaurant code when no logo exists", () => {
    expect(restaurantAppIcons("FIT01", null)).toEqual([
      { src: "/staff-icon/192?outlet=FIT01", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/staff-icon/512?outlet=FIT01", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});
