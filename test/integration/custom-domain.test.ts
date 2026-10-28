import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveTxt } from "node:dns/promises";
import { NextRequest } from "next/server";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { clearCustomDomainProofCache, outletCodeForCustomDomain } from "@/server/guest/custom-domain";
import { saveCustomDomain, setCustomDomainLive } from "@/server/staff/custom-domain";
import { proxy } from "../../src/proxy";
import { resetTestDb } from "./setup-db";

vi.mock("node:dns/promises", () => ({ resolveTxt: vi.fn() }));

let env: Awaited<ReturnType<typeof resetTestDb>>;
let secondOutletId: string;
let originalPublicUrl: string | undefined;
const owner = (outletId = env.demo.outletId, roles: ("owner" | "manager")[] = ["owner"]) => ({
  tenantId: env.demo.tenantId, outletId, roles, userId: env.demo.staffIds.owner, name: "Owner",
});

beforeAll(async () => {
  originalPublicUrl = process.env.PUBLIC_APP_URL;
  env = await resetTestDb();
  secondOutletId = uuidv7();
  await env.db.insert(s.outlets).values({ id: secondOutletId, tenantId: env.demo.tenantId, brandId: env.demo.brandId, code: "SRJ02", name: "Spice Route Two", city: "Jaipur", address: "MI Road" });
});

afterAll(async () => {
  if (originalPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = originalPublicUrl;
  await env.conn.end();
  await appDb.$client.end();
});

describe("custom guest domain routing", () => {
  it("routes only live domains with current DNS proof and safely falls back when proof disappears", async () => {
    process.env.PUBLIC_APP_URL = "https://tableeqr.example";
    const saved = await saveCustomDomain(owner(), "Menu.Example.com.");
    expect(saved.domain).toBe("menu.example.com");
    expect(saved.token).toMatch(/^[a-f\d]{48}$/);
    expect(await outletCodeForCustomDomain("menu.example.com")).toBeNull();
    expect(await outletCodeForCustomDomain("spoof-menu.example.com")).toBeNull();
    const request = new NextRequest("https://menu.example.com/");
    expect((await proxy(request)).headers.get("location")).toBe("https://tableeqr.example/");
    await expect(setCustomDomainLive(owner(), true)).rejects.toMatchObject({ code: "invalid_state" });

    vi.mocked(resolveTxt).mockResolvedValue([[`tableqr-verify=${saved.token}`]]);
    await env.db.update(s.outlets).set({ customDomainVerifiedAt: new Date() }).where(eq(s.outlets.id, env.demo.outletId));
    clearCustomDomainProofCache();
    expect(await outletCodeForCustomDomain("menu.example.com")).toBeNull();
    await setCustomDomainLive(owner(), true, true);
    clearCustomDomainProofCache();
    expect(await outletCodeForCustomDomain("MENU.EXAMPLE.COM:443")).toBe("SRJ01");
    expect((await proxy(request)).headers.get("x-middleware-rewrite")).toContain("/r/SRJ01");
    const guestRequest = new NextRequest("https://menu.example.com/r/OTHER/t/table123?from=qr");
    expect((await proxy(guestRequest)).headers.get("x-middleware-rewrite")).toContain("/r/SRJ01/t/table123?from=qr");
    expect(await outletCodeForCustomDomain("menu.example.com,evil.example")).toBeNull();
    expect(await outletCodeForCustomDomain("http://menu.example.com")).toBeNull();

    const duplicate = await saveCustomDomain(owner(secondOutletId), "menu.example.com").then(() => null, (error: unknown) => error);
    expect(duplicate).toBeInstanceOf(AppError);
    expect((duplicate as AppError).code).toBe("invalid_state");

    vi.mocked(resolveTxt).mockResolvedValue([]);
    clearCustomDomainProofCache();
    expect(await outletCodeForCustomDomain("menu.example.com")).toBeNull();
    const fallback = await proxy(guestRequest);
    expect(fallback.headers.get("location")).toBe("https://tableeqr.example/r/OTHER/t/table123?from=qr");

    await saveCustomDomain(owner(), null);
    clearCustomDomainProofCache();
    expect(await outletCodeForCustomDomain("menu.example.com")).toBeNull();
    const removedDomainFallback = await proxy(request);
    expect(removedDomainFallback.headers.get("location")).toBe("https://tableeqr.example/");
  });

  it("limits domain ownership changes to the outlet owner", async () => {
    await expect(saveCustomDomain(owner(env.demo.outletId, ["manager"]), "manager.example.com"))
      .rejects.toMatchObject({ code: "forbidden" });
  });
});
