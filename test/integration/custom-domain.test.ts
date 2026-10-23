import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { outletCodeForCustomDomain } from "@/server/guest/custom-domain";
import { saveCustomDomain, setCustomDomainLive } from "@/server/staff/custom-domain";
import { proxy } from "../../proxy";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let secondOutletId: string;
const owner = (outletId = env.demo.outletId, roles: ("owner" | "manager")[] = ["owner"]) => ({
  tenantId: env.demo.tenantId, outletId, roles, userId: env.demo.staffIds.owner, name: "Owner",
});

beforeAll(async () => {
  env = await resetTestDb();
  secondOutletId = uuidv7();
  await env.db.insert(s.outlets).values({ id: secondOutletId, tenantId: env.demo.tenantId, brandId: env.demo.brandId, code: "SRJ02", name: "Spice Route Two", city: "Jaipur", address: "MI Road" });
});

afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("custom guest domain routing", () => {
  it("routes only exact DNS-verified domains to their outlet and stops after removal", async () => {
    const saved = await saveCustomDomain(owner(), "Menu.Example.com.");
    expect(saved.domain).toBe("menu.example.com");
    expect(saved.token).toMatch(/^[a-f\d]{48}$/);
    expect(await outletCodeForCustomDomain("menu.example.com")).toBeNull();
    expect(await outletCodeForCustomDomain("spoof-menu.example.com")).toBeNull();
    const request = new NextRequest("https://menu.example.com/");
    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    await expect(setCustomDomainLive(owner(), true)).rejects.toMatchObject({ code: "invalid_state" });

    await env.db.update(s.outlets).set({ customDomainVerifiedAt: new Date() }).where(eq(s.outlets.id, env.demo.outletId));
    expect(await outletCodeForCustomDomain("menu.example.com")).toBeNull();
    await setCustomDomainLive(owner(), true);
    expect(await outletCodeForCustomDomain("MENU.EXAMPLE.COM:443")).toBe("SRJ01");
    expect((await proxy(request)).headers.get("x-middleware-rewrite")).toContain("/r/SRJ01");
    expect(await outletCodeForCustomDomain("menu.example.com,evil.example")).toBeNull();
    expect(await outletCodeForCustomDomain("http://menu.example.com")).toBeNull();

    const duplicate = await saveCustomDomain(owner(secondOutletId), "menu.example.com").then(() => null, (error: unknown) => error);
    expect(duplicate).toBeInstanceOf(AppError);
    expect((duplicate as AppError).code).toBe("invalid_state");

    await saveCustomDomain(owner(), null);
    expect(await outletCodeForCustomDomain("menu.example.com")).toBeNull();
  });

  it("limits domain ownership changes to the outlet owner", async () => {
    await expect(saveCustomDomain(owner(env.demo.outletId, ["manager"]), "manager.example.com"))
      .rejects.toMatchObject({ code: "forbidden" });
  });
});
