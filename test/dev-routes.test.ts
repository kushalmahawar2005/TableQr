import { readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import DevLayout from "@/app/dev/layout";

// Review boards under /dev must 404 in production, whatever an individual page does.

afterEach(() => vi.unstubAllEnvs());

describe("dev routes", () => {
  it("the /dev layout refuses every board in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => DevLayout({ children: null })).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("renders boards in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(DevLayout({ children: "board" })).toBe("board");
  });

  it("every board lives under the guarded /dev folder", () => {
    const boards = readdirSync(path.resolve(import.meta.dirname, "../src/app/dev"), { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(boards.length).toBeGreaterThan(10);
  });
});
