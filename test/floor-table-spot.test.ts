import { describe, expect, it } from "vitest";
import { freeTableSpot } from "@/server/floor/editor";

// "+ Square table" puts the new table in the first empty place of its area, below the area's name tag.

const zone = { posX: 10, posY: 5, width: 12, height: 8 };
const table = (posX: number, posY: number) => ({ posX, posY, width: 2, height: 2 });

describe("new table placement in the floor editor", () => {
  it("starts under the name tag of an empty area", () => {
    expect(freeTableSpot(zone, [], 2, 2)).toEqual({ x: 11, y: 7 });
  });

  it("never lands on a table that is already there", () => {
    const spot = freeTableSpot(zone, [table(11, 7), table(13, 7)], 2, 2);
    expect(spot).toEqual({ x: 15, y: 7 });
  });

  it("goes below everything in a full area", () => {
    const full = [];
    for (let y = 7; y < 13; y += 2) for (let x = 11; x < 22; x += 2) full.push(table(x, y));
    expect(freeTableSpot(zone, full, 2, 2)).toEqual({ x: 11, y: 14 });
  });
});
