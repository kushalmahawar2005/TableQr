import { describe, expect, it } from "vitest";
import { amountInWords, numberInWords } from "./words";

describe("numberInWords", () => {
  it("uses the Indian system", () => {
    expect(numberInWords(2090)).toBe("Two Thousand Ninety");
    expect(numberInWords(541)).toBe("Five Hundred Forty One");
    expect(numberInWords(184200)).toBe("One Lakh Eighty Four Thousand Two Hundred");
    expect(numberInWords(10_00_00_000)).toBe("Ten Crore");
    expect(numberInWords(12_34_56_789)).toBe("Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine");
    expect(numberInWords(100000)).toBe("One Lakh");
    expect(numberInWords(19)).toBe("Nineteen");
  });
});

describe("amountInWords", () => {
  it("writes rupees and paise for the invoice", () => {
    expect(amountInWords(209000)).toBe("Rupees Two Thousand Ninety Only");
    expect(amountInWords(54075)).toBe("Rupees Five Hundred Forty and Seventy Five Paise Only");
  });
});
