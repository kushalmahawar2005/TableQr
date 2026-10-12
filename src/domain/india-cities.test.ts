import { describe, expect, it } from "vitest";
import { searchCities } from "./india-cities";

describe("city suggestions", () => {
  it("puts cities that start with the typed text first", () => {
    const names = searchCities("jai").map((c) => c.name);
    expect(names.slice(0, 2)).toEqual(["Jaipur", "Jaisalmer"]);
    expect(searchCities("Jaipur")[0]).toEqual({ name: "Jaipur", state: "Rajasthan" });
  });

  it("matches inside names and by state, and ignores spaces and case", () => {
    expect(searchCities("navi mum").map((c) => c.name)).toContain("Navi Mumbai");
    expect(searchCities("rajasthan", 50).some((c) => c.name === "Udaipur")).toBe(true);
    expect(searchCities("")).toEqual([]);
  });
});
