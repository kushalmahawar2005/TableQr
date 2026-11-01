import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

describe("a refresh stays where you were", () => {
  it("keeps the admin page in the address", () => {
    const shell = read("src/app/admin/admin-client.tsx");
    expect(shell).toMatch(/\?page=\$\{pageSlug\(page\)\}/);
    expect(shell).toMatch(/popstate/);
    expect(read("src/app/admin/page.tsx")).toMatch(/initialPage=\{\(await props\.searchParams\)\.page\}/);
  });

  it("keeps the guest cart and leads a placed order back to tracking", () => {
    const screen = read("src/app/(guest)/r/[outlet]/delivery/screen.tsx");
    expect(screen).toMatch(/sessionStorage\.setItem\(draftKey/);
    expect(screen).toMatch(/replaceState\(null, "", `\$\{base\}\/delivery\?mode=\$\{status\.serviceMode\}`\)/);
  });
});
