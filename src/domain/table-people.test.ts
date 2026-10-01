import { describe, expect, it } from "vitest";
import { encodeQr } from "./qr";
import { initials, orderedSoFar, personLabel, tablePeople } from "./table-people";

const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 12, n));
const row = (id: string, displayName: string, n: number, extra: { paid?: boolean; removed?: boolean } = {}) => ({
  id,
  displayName,
  joinedAt: at(n),
  paidOutAt: extra.paid ? at(50) : null,
  removedAt: extra.removed ? at(51) : null,
});
const labels = { you: "You", youSuffix: "(You)", anotherGuest: "Another guest" };

describe("G7 people list", () => {
  const rows = [
    row("a", "Riya", 1),
    row("b", "Guest 2", 2),
    row("c", "Aarav", 3),
    row("d", "Karan", 4, { paid: true }),
    row("e", "Vivek", 5, { removed: true }),
  ];

  it("masks stand-in names and never exposes Guest N", () => {
    const people = tablePeople(rows, "c", "a");
    expect(people.map((p) => p.name)).not.toContain("Guest 2");
    expect(people.find((p) => p.id === "b")?.name).toBeNull();
    expect(personLabel(people.find((p) => p.id === "b")!, labels)).toBe("Another guest");
  });

  it("labels the current participant as You", () => {
    const people = tablePeople(rows, "c", "a");
    expect(personLabel(people.find((p) => p.isMe)!, labels)).toBe("Aarav (You)");
    const placeholderMe = tablePeople(rows, "b", "a").find((p) => p.isMe)!;
    expect(personLabel(placeholderMe, labels)).toBe("You");
  });

  it("identifies exactly one host and lists host, you, others, then paid and left", () => {
    const people = tablePeople(rows, "c", "a");
    expect(people.filter((p) => p.isHost).map((p) => p.id)).toEqual(["a"]);
    expect(people.map((p) => p.id)).toEqual(["a", "c", "b", "d"]);
    expect(people.find((p) => p.id === "d")?.state).toBe("paid");
  });

  it("leaves removed people out entirely", () => {
    expect(tablePeople(rows, "c", "a").map((p) => p.id)).not.toContain("e");
  });

  it("makes initials from Latin and Devanagari names", () => {
    expect(initials("Aarav")).toBe("A");
    expect(initials("Anne Marie")).toBe("AM");
    expect(initials("प्रिया")).toBe("प");
    expect(initials(null)).toBeNull();
  });
});

describe("G7 ordered so far", () => {
  it("sums placed snapshot prices and leaves out cancelled and voided lines", () => {
    const summary = orderedSoFar([
      { orderId: "r1", unitPricePaise: 28000, qty: 2, status: "served" },
      { orderId: "r1", unitPricePaise: 9000, qty: 1, status: "cancelled" },
      { orderId: "r2", unitPricePaise: 34000, qty: 1, status: "preparing" },
      { orderId: "r2", unitPricePaise: 6000, qty: 3, status: "placed" },
      { orderId: "r3", unitPricePaise: 12000, qty: 1, status: "voided" },
    ]);
    expect(summary).toEqual({ totalPaise: 28000 * 2 + 34000 + 6000 * 3, items: 6, rounds: 2, inKitchen: 4 });
  });

  it("is zero before anything is ordered", () => {
    expect(orderedSoFar([])).toEqual({ totalPaise: 0, items: 0, rounds: 0, inKitchen: 0 });
  });
});

describe("invite QR", () => {
  it("encodes a table address in a small, standard symbol", () => {
    const qr = encodeQr("https://tableqr.example/r/SRJ01/t/k7Qm");
    expect(qr.version).toBe(3);
    expect(qr.size).toBe(29);
    // Finder pattern corners are dark, their separators light
    for (const [x, y] of [[0, 0], [qr.size - 1, 0], [0, qr.size - 1]]) expect(qr.modules[y][x]).toBe(true);
    expect(qr.modules[7][7]).toBe(false);
    // The dark module next to the bottom-left finder is always set
    expect(qr.modules[qr.size - 8][8]).toBe(true);
  });

  it("is deterministic and refuses text that cannot fit", () => {
    const a = encodeQr("/r/SRJ01/t/k7Qm");
    expect(encodeQr("/r/SRJ01/t/k7Qm")).toEqual(a);
    expect(() => encodeQr("x".repeat(400))).toThrow();
  });
});
