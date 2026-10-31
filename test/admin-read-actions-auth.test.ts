import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }));
const readers = vi.hoisted(() => ({
  getTenantDetail: vi.fn(),
  getAnalyticsData: vi.fn(),
  getAuditData: vi.fn(),
  getSettingsData: vi.fn(),
  commercialFor: vi.fn(),
}));

vi.mock("@/server/admin/auth", () => ({
  requirePlatformAdmin: auth.requirePlatformAdmin,
  signInPlatformAdmin: vi.fn(),
  signOutPlatformAdmin: vi.fn(),
}));
vi.mock("@/server/admin/tenant-detail", () => ({ getTenantDetail: readers.getTenantDetail }));
vi.mock("@/server/admin/analytics", () => ({ getAnalyticsData: readers.getAnalyticsData }));
vi.mock("@/server/admin/audit", () => ({ getAuditData: readers.getAuditData }));
vi.mock("@/server/admin/settings", () => ({ getSettingsData: readers.getSettingsData }));
vi.mock("@/server/admin/commercial", () => ({ commercialFor: readers.commercialFor }));

import {
  getAnalyticsAction,
  getAuditAction,
  getCommercialAction,
  getSettingsAction,
  getTenantDetailAction,
} from "@/app/admin/actions";

describe("platform admin read actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requirePlatformAdmin.mockRejectedValue(new Error("Platform admin sign-in required"));
  });

  it("does not return protected platform data to an anonymous caller", async () => {
    const results = await Promise.all([
      getTenantDetailAction("tenant-id"),
      getAnalyticsAction("month" as never),
      getAuditAction(),
      getSettingsAction(),
      getCommercialAction("tenant-id"),
    ]);

    expect(results.every((result) => result.error !== null)).toBe(true);
    expect(auth.requirePlatformAdmin).toHaveBeenCalledTimes(5);
    expect(readers.getTenantDetail).not.toHaveBeenCalled();
    expect(readers.getAnalyticsData).not.toHaveBeenCalled();
    expect(readers.getAuditData).not.toHaveBeenCalled();
    expect(readers.getSettingsData).not.toHaveBeenCalled();
    expect(readers.commercialFor).not.toHaveBeenCalled();
  });
});
