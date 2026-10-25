import { describe, expect, it } from "vitest";
import { actionRoles, canSee, cleanRoleAccess, sectionRoles } from "./staff-permissions";

describe("per-restaurant role access", () => {
  it("follows the defaults until the admin changes a section", () => {
    expect(sectionRoles("billing", null)).toEqual(["cashier", "manager", "owner", "accountant", "reception"]);
    expect(canSee({ roles: ["cashier"], access: null }, "billing")).toBe(true);
  });

  it("takes a section away from a role, but never from the owner", () => {
    const access = { billing: ["manager" as const] };
    expect(canSee({ roles: ["cashier"], access }, "billing")).toBe(false);
    expect(canSee({ roles: ["owner"], access: { billing: [] } }, "billing")).toBe(true);
    expect(actionRoles(["cashier", "manager", "owner", "accountant", "reception"], "billing", access)).toEqual(["manager", "owner"]);
  });

  it("gives read-only sections to more roles, and their general actions with them", () => {
    const access = { customers: ["manager" as const, "host" as const] };
    expect(canSee({ roles: ["host"], access }, "customers")).toBe(true);
    expect(actionRoles(["manager", "owner"], "customers", access)).toEqual(["manager", "owner", "host"]);
  });

  it("refuses to widen a section whose actions are tied to roles, and drops unchanged sections", () => {
    expect(cleanRoleAccess({ settings: ["cashier"], billing: ["cashier", "manager", "accountant", "reception"], bogus: ["owner"] }))
      .toEqual({ settings: [] });
    expect(cleanRoleAccess({ reports: ["manager", "accountant", "cashier"] })).toEqual({ reports: ["manager", "accountant", "cashier"] });
    expect(cleanRoleAccess("nonsense")).toEqual({});
  });
});
