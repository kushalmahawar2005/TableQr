import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every screen gets the realtime address from the server at request time (REALTIME_URL), so one
// setting on the host turns realtime on everywhere without a rebuild. Nothing realtime goes through a
// NEXT_PUBLIC_ variable, and no realtime secret can reach a browser bundle.

const SRC = path.resolve(import.meta.dirname, "../src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

describe("realtime configuration", () => {
  it("never reads a NEXT_PUBLIC_ realtime variable", () => {
    const hits = files(SRC).filter((f) => /NEXT_PUBLIC_REALTIME/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("gives the waiter app, POS, console billing and guest waitlist the server's realtime address", () => {
    const server = 'process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null';
    for (const page of ["app/(staff)/waiter/page.tsx", "app/pos/page.tsx", "app/(console)/console/(app)/billing/page.tsx", "app/(guest)/r/[outlet]/waitlist/page.tsx"]) {
      expect(read(page), page).toContain(server);
    }
    expect(read("app/(guest)/r/[outlet]/waitlist/waitlist-client.tsx")).toContain("url: realtimeUrl");
  });

  it("keeps the realtime secrets out of anything a browser loads", () => {
    const client = files(SRC).filter((f) => readFileSync(f, "utf8").startsWith('"use client"'));
    for (const f of client) expect(readFileSync(f, "utf8"), path.relative(SRC, f)).not.toMatch(/REALTIME_(PUBLISH|TOKEN)_SECRET/);
    expect(files(SRC).some((f) => /NEXT_PUBLIC_[A-Z_]*SECRET/.test(readFileSync(f, "utf8")))).toBe(false);
  });
});
