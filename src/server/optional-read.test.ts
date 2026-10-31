import { describe, expect, it, vi } from "vitest";
import { readOptional } from "./optional-read";

describe("readOptional", () => {
  it("returns its fallback and reports the error when an optional read fails", async () => {
    const onError = vi.fn();
    const error = new Error("temporary database failure");

    await expect(readOptional(Promise.reject(error), [], onError)).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("returns successful data without reporting an error", async () => {
    const onError = vi.fn();

    await expect(readOptional(Promise.resolve(["order"]), [], onError)).resolves.toEqual(["order"]);
    expect(onError).not.toHaveBeenCalled();
  });
});
