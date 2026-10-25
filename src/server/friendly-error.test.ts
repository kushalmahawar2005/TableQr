import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { friendlyError } from "./friendly-error";

describe("friendlyError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows our own messages and short plain ones", () => {
    expect(friendlyError(new AppError("invalid_state", "Enter a valid price."), "x")).toBe("Enter a valid price.");
    expect(friendlyError(new Error("That outlet code is already in use."), "x")).toBe("That outlet code is already in use.");
  });

  it("hides database and system messages behind the fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sql = new Error("Failed query: insert into `users` (`id`, `pin_hash`) values (?, ?)\nparams: 01a1,$2b$10$abc");
    expect(friendlyError(sql, "PIN could not be reset.")).toBe("PIN could not be reset.");
    expect(friendlyError(new Error("connect ECONNREFUSED 127.0.0.1:3306"), "Try again.")).toBe("Try again.");
    expect(friendlyError("boom", "Try again.")).toBe("Try again.");
  });
});
