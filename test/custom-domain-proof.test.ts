import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTxt } from "node:dns/promises";
import { customDomainProofRecord } from "@/domain/custom-domain-proof";
import { hasCustomDomainProof } from "@/server/custom-domain-proof";

vi.mock("node:dns/promises", () => ({ resolveTxt: vi.fn() }));

beforeEach(() => { vi.mocked(resolveTxt).mockReset(); });

describe("domain proof after the Tableeqr rename", () => {
  it("shows and verifies the new branded TXT record", async () => {
    expect(customDomainProofRecord("menu.example.com", "token-1")).toEqual({ name: "_tableeqr-verify.menu.example.com", value: "tableeqr-verify=token-1" });
    vi.mocked(resolveTxt).mockResolvedValue([["tableeqr-verify=", "token-1"]]);
    expect(await hasCustomDomainProof("menu.example.com", "token-1")).toBe(true);
    expect(resolveTxt).toHaveBeenCalledExactlyOnceWith("_tableeqr-verify.menu.example.com");
  });

  it("keeps an existing domain working with its original ownership record", async () => {
    vi.mocked(resolveTxt).mockRejectedValueOnce(new Error("ENOTFOUND")).mockResolvedValueOnce([["tableqr-verify=token-1"]]);
    expect(await hasCustomDomainProof("menu.example.com", "token-1")).toBe(true);
    expect(resolveTxt).toHaveBeenLastCalledWith("_tableqr-verify.menu.example.com");
  });

  it("rejects mismatched or missing proof under both names", async () => {
    vi.mocked(resolveTxt).mockResolvedValue([["tableeqr-verify=wrong"], ["tableqr-verify=wrong"]]);
    expect(await hasCustomDomainProof("menu.example.com", "token-1")).toBe(false);
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));
    expect(await hasCustomDomainProof("menu.example.com", "token-1")).toBe(false);
  });
});
