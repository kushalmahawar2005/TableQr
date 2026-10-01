import { describe, expect, it } from "vitest";
import { g1Copy } from "./_copy";

describe("G1 people line", () => {
  const { en, hi } = g1Copy;

  it("names up to three people in full", () => {
    expect(en.peopleHere(["Aarav"])).toBe("Aarav is here");
    expect(en.peopleHere(["Aarav", "Bhavna"])).toBe("Aarav and Bhavna are here");
    expect(en.peopleHere(["Aarav", "Bhavna", "Chirag"])).toBe("Aarav, Bhavna and Chirag are here");
    expect(hi.peopleHere(["Aarav", "Bhavna", "Chirag"])).toBe("Aarav, Bhavna और Chirag यहाँ हैं");
  });

  it("shortens from four people", () => {
    expect(en.peopleHere(["Aarav", "Bhavna", "Chirag", "Divya"])).toBe("Aarav, Bhavna, Chirag and 1 more are here");
    expect(en.peopleHere(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more are here");
    expect(hi.peopleHere(["A", "B", "C", "D"])).toBe("A, B, C और 1 व्यक्ति यहाँ हैं");
  });

  it("uses only a head count when names are not all known", () => {
    expect(en.peopleCount(3)).toBe("3 people are at this table");
    expect(en.peopleCount(1)).toBe("1 person is at this table");
  });
});
