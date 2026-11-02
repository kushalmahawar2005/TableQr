import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentStaff: vi.fn(), getConsoleNotices: vi.fn(), getLiveOrderCounts: vi.fn() }));
vi.mock("@/server/staff/request", () => ({ currentStaff: mocks.currentStaff }));
vi.mock("@/server/staff/notifications", () => ({ getConsoleNotices: mocks.getConsoleNotices, getLiveOrderCounts: mocks.getLiveOrderCounts }));

import { noticesAction } from "@/app/(console)/console/(app)/_components/notification-actions";

describe("console notice polling session binding", () => {
  beforeEach(() => {
    mocks.currentStaff.mockReset();
    mocks.getConsoleNotices.mockReset().mockResolvedValue([]);
    mocks.getLiveOrderCounts.mockReset().mockResolvedValue({ table: 1, guest: 2 });
  });

  it("does not return another login's notices to a tab left open", async () => {
    mocks.currentStaff.mockResolvedValue({ sessionId: "session-b" });

    expect(await noticesAction(Date.now() - 60_000, "session-a")).toEqual({ ok: false });
    expect(mocks.getConsoleNotices).not.toHaveBeenCalled();
  });

  it("returns notices only when the browser session still matches", async () => {
    mocks.currentStaff.mockResolvedValue({ sessionId: "session-a" });

    const result = await noticesAction(Date.now() - 60_000, "session-a");
    expect(result).toMatchObject({ ok: true, notices: [], waiting: { table: 1, guest: 2 } });
    expect(mocks.getConsoleNotices).toHaveBeenCalledOnce();
  });
});
