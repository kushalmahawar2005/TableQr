import { describe, expect, it } from "vitest";
import { readyPhrase, requestPhrase, spokenPlace } from "@/lib/voice-alert";

describe("spoken alerts", () => {
  it("reads table, room and delivery codes the way staff say them", () => {
    expect(spokenPlace("T1", "en")).toBe("table 1");
    expect(spokenPlace("T12", "hi")).toBe("टेबल 12");
    expect(spokenPlace("Room 204", "en")).toBe("room 204");
    expect(spokenPlace("DL-t7QqWGrij", "en")).toBe("delivery");
  });
  it("turns a request into a sentence in the waiter's language", () => {
    expect(requestPhrase("water", "T1", "en")).toBe("Table 1 needs water");
    expect(requestPhrase("water", "T1", "hi")).toBe("टेबल 1 को पानी चाहिए");
    expect(requestPhrase("request_bill", "T3", "hi")).toBe("टेबल 3 बिल माँग रही है");
    expect(requestPhrase("something_new", "T2", "en")).toBe("New request at table 2");
    expect(readyPhrase("T4", "en")).toBe("Food is ready for table 4");
  });
});
