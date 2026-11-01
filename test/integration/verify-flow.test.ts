import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { startOrJoinTable } from "@/server/guest/session";
import { isRecentlyVerified, sendCode, verifyCode } from "@/server/guest/verify";
import { mockSms } from "@/server/sms/sender";
import { resetTestDb } from "./setup-db";

// G2 Verify number: sending, checking and the 12-hour skip, all against the real database.

let env: Awaited<ReturnType<typeof resetTestDb>>;

beforeAll(async () => {
  env = await resetTestDb();
  await env.db.update(s.outlets).set({ sessionMode: "verified" }).where(eq(s.outlets.id, env.demo.outletId));
  await env.db.update(s.outlets).set({ sessionMode: "verified" }).where(eq(s.outlets.id, env.other.outletId));
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

const T0 = new Date("2026-10-01T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

/** Sends a code from a phone at a table and returns the challenge with its (mock) code */
async function send(table: string, deviceId: string, phone: string, now = T0) {
  const res = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr[table], deviceId, country: "IN", phone, now });
  if (!res.ok) throw new Error(`send failed: ${res.error}`);
  return res as typeof res & { devCode: string };
}

const verify = (table: string, deviceId: string, challengeId: string, code: string, now = T0, extra: { name?: string; consent?: boolean } = {}) =>
  verifyCode({
    outletCode: "SRJ01",
    shortCode: env.demo.tableQr[table],
    deviceId,
    challengeId,
    code,
    name: extra.name ?? "Aarav",
    consent: extra.consent ?? false,
    now,
  });

const wrong = (code: string) => String((Number(code) + 1) % 10000).padStart(4, "0");

const guestByPhone = async (phone: string) =>
  (await env.db.select().from(s.guests).where(and(eq(s.guests.tenantId, env.demo.tenantId), eq(s.guests.phone, phone))))[0];

describe("G2 verify number", () => {
  it("asks Verified-mode tables for a number, then joins with the verified name", async () => {
    // Guests can enter and browse first; OTP is required at order placement.
    const beforeOtp = await startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T1, deviceId: "d-happy", now: T0 });
    expect(beforeOtp.isHost).toBe(true);

    const sent = await send("T1", "d-happy", "98765 43210");
    expect(sent).toMatchObject({ phone: "+919876543210", expiresIn: 300, resendIn: 60 });
    expect(sent.devCode).toMatch(/^\d{4}$/);
    expect(mockSms.lastCode("+919876543210")).toBe(sent.devCode);

    const res = await verify("T1", "d-happy", sent.challengeId, sent.devCode, at(20), { name: " आरव " });
    expect(res.ok).toBe(true);

    const joined = await startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T1, deviceId: "d-happy", now: at(21) });
    const [p] = await env.db.select().from(s.participants).where(eq(s.participants.id, joined.participantId));
    const guest = await guestByPhone("+919876543210");
    expect(p).toMatchObject({ displayName: "आरव", guestId: guest.id });
    expect(joined.isHost).toBe(true);
  });

  it("stores only a hash of the code", async () => {
    const sent = await send("T2", "d-hash", "9876500001");
    const [row] = await env.db.select().from(s.otpChallenges).where(eq(s.otpChallenges.id, sent.challengeId));
    expect(row.codeHash).toHaveLength(64);
    expect(row.codeHash).not.toContain(sent.devCode);
  });

  it("returns the code already sent when asked again within 60 seconds, and a new one after", async () => {
    const first = await send("T2", "d-resend", "9876500002");
    const again = await send("T2", "d-resend", "9876500002", at(10));
    expect(again.challengeId).toBe(first.challengeId);
    expect(again.resendIn).toBe(50);
    expect(again.devCode).toBeUndefined();

    const fresh = await send("T2", "d-resend", "9876500002", at(61));
    expect(fresh.challengeId).not.toBe(first.challengeId);
    // The older code is dead
    expect(await verify("T2", "d-resend", first.challengeId, first.devCode, at(62))).toEqual({ ok: false, error: "expired" });
    expect((await verify("T2", "d-resend", fresh.challengeId, fresh.devCode, at(63))).ok).toBe(true);
  });

  it("changing the number kills the old code", async () => {
    const first = await send("T3", "d-change", "9876500003");
    const other = await send("T3", "d-change", "9876500004", at(5));
    expect(await verify("T3", "d-change", first.challengeId, first.devCode, at(6))).toEqual({ ok: false, error: "expired" });
    expect((await verify("T3", "d-change", other.challengeId, other.devCode, at(7))).ok).toBe(true);
  });

  it("expires a code after 5 minutes", async () => {
    const sent = await send("T4", "d-expire", "9876500005");
    expect(await verify("T4", "d-expire", sent.challengeId, sent.devCode, at(300))).toEqual({ ok: false, error: "expired" });
  });

  it("locks the number and the phone for 60 seconds after three wrong codes, then needs a new code", async () => {
    const sent = await send("T5", "d-lock", "9876500006");
    expect(await verify("T5", "d-lock", sent.challengeId, wrong(sent.devCode), at(1))).toEqual({ ok: false, error: "wrong", attemptsLeft: 2 });
    expect(await verify("T5", "d-lock", sent.challengeId, wrong(sent.devCode), at(2))).toEqual({ ok: false, error: "wrong", attemptsLeft: 1 });
    expect(await verify("T5", "d-lock", sent.challengeId, wrong(sent.devCode), at(3))).toEqual({ ok: false, error: "locked", retryIn: 60 });
    // Even the right code does nothing during the lockout
    expect(await verify("T5", "d-lock", sent.challengeId, sent.devCode, at(4))).toEqual({ ok: false, error: "locked", retryIn: 59 });

    // Locked: the same number from another phone, and another number from the same phone
    const blockedNumber = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T5, deviceId: "d-other", country: "IN", phone: "9876500006", now: at(10) });
    expect(blockedNumber).toEqual({ ok: false, error: "locked", retryIn: 53 });
    const blockedPhone = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T5, deviceId: "d-lock", country: "IN", phone: "9876500007", now: at(10) });
    expect(blockedPhone).toMatchObject({ ok: false, error: "locked" });
    // The rest of the table is not locked
    expect((await send("T5", "d-neighbour", "9876500008", at(10))).ok).toBe(true);

    // After the lockout the old code is dead and a new one works
    expect(await verify("T5", "d-lock", sent.challengeId, sent.devCode, at(64))).toEqual({ ok: false, error: "expired" });
    const fresh = await send("T5", "d-lock", "9876500006", at(64));
    expect((await verify("T5", "d-lock", fresh.challengeId, fresh.devCode, at(65))).ok).toBe(true);
  });

  it("limits codes per phone (device) per 10 minutes", async () => {
    for (const [i, n] of ["9876500011", "9876500012", "9876500013"].entries()) await send("T6", "d-limit", n, at(i));
    const res = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T6, deviceId: "d-limit", country: "IN", phone: "9876500014", now: at(5) });
    expect(res).toEqual({ ok: false, error: "rate_limited" });
    expect((await send("T6", "d-limit", "9876500014", at(601))).ok).toBe(true);
  });

  it("limits codes per number per day", async () => {
    // A new phone each time, spread out so the per-phone and per-table limits stay clear
    for (let i = 0; i < 5; i++) await send("T8", `d-day-${i}`, "9876500020", at(i * 700));
    const res = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T8, deviceId: "d-day-x", country: "IN", phone: "9876500020", now: at(4000) });
    expect(res).toEqual({ ok: false, error: "rate_limited" });
  });

  it("limits codes per table per 10 minutes", async () => {
    for (let i = 0; i < 10; i++) await send("T9", `d-table-${i}`, `98765001${String(i).padStart(2, "0")}`, at(i));
    const res = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T9, deviceId: "d-table-x", country: "IN", phone: "9876500199", now: at(20) });
    expect(res).toEqual({ ok: false, error: "rate_limited" });
  });

  it("refuses numbers outside India and invalid numbers before sending anything", async () => {
    const base = { outletCode: "SRJ01", shortCode: env.demo.tableQr.T10, deviceId: "d-intl", now: T0 };
    expect(await sendCode({ ...base, country: "AE", phone: "501234567" })).toEqual({ ok: false, error: "unsupported_country" });
    expect(await sendCode({ ...base, country: "IN", phone: "5876543210" })).toEqual({ ok: false, error: "invalid_phone" });
  });

  it("says when the SMS could not be sent, and does not leave that code alive", async () => {
    mockSms.failing = true;
    try {
      const res = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T10, deviceId: "d-sms", country: "IN", phone: "9876500030", now: T0 });
      expect(res).toEqual({ ok: false, error: "sms_failed" });
    } finally {
      mockSms.failing = false;
    }
    const rows = await env.db.select().from(s.otpChallenges).where(eq(s.otpChallenges.deviceId, "d-sms"));
    expect(rows[0].deadAt).not.toBeNull();
  });

  it("rejects names with emoji or symbols without using up a try", async () => {
    const sent = await send("T11", "d-name", "9876500040");
    expect(await verify("T11", "d-name", sent.challengeId, sent.devCode, at(1), { name: "Aarav 😀" })).toEqual({ ok: false, error: "invalid_name" });
    expect((await verify("T11", "d-name", sent.challengeId, sent.devCode, at(2), { name: "D'Souza" })).ok).toBe(true);
  });

  it("saves the consent checkbox as it is now, including withdrawing an earlier yes", async () => {
    const phone = "9876500050";
    const a = await send("B1", "d-consent", phone);
    await verify("B1", "d-consent", a.challengeId, a.devCode, at(1), { consent: true });
    expect(await guestByPhone("+919876500050")).toMatchObject({
      consentPersonalisation: true,
      consentMarketing: true,
      consentVersion: "v1",
      consentAt: at(1),
    });

    const b = await send("B2", "d-consent-2", phone, at(100));
    await verify("B2", "d-consent-2", b.challengeId, b.devCode, at(101), { consent: false, name: "Kabir" });
    expect(await guestByPhone("+919876500050")).toMatchObject({
      name: "Kabir",
      consentPersonalisation: false,
      consentMarketing: false,
      consentVersion: "v1",
      consentAt: at(101),
    });
  });

  it("skips G2 at any table of the restaurant within 12 hours, but not after 12 hours", async () => {
    const qr = env.demo.tableQr.B3;
    const sent = await send("B3", "d-skip", "9876500060");
    await verify("B3", "d-skip", sent.challengeId, sent.devCode, at(1), { name: "Meera" });
    const first = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "d-skip", now: at(2) });

    // The session closes (paid and cleaned) and the guest scans again two hours later
    await env.db.update(s.tableSessions).set({ status: "closed", openKey: null }).where(eq(s.tableSessions.id, first.sessionId));
    // A real close also lets go of the table (S1 session_tables)
    await env.db.update(s.sessionTables).set({ activeKey: null, releasedAt: new Date() }).where(eq(s.sessionTables.sessionId, first.sessionId));
    await env.db.update(s.diningTables).set({ state: "available" }).where(eq(s.diningTables.id, env.demo.tableIds.B3));
    expect(await isRecentlyVerified("SRJ01", qr, "d-skip", at(7200))).toBe(true);
    const again = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "d-skip", now: at(7200) });
    expect(again.sessionId).not.toBe(first.sessionId);
    const [p] = await env.db.select().from(s.participants).where(eq(s.participants.id, again.participantId));
    expect(p.displayName).toBe("Meera");

    // Another table of this restaurant trusts the same phone; 12 hours later both ask again
    const anotherTable = await startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.B4, deviceId: "d-skip", now: at(7200) });
    const [anotherParticipant] = await env.db.select().from(s.participants).where(eq(s.participants.id, anotherTable.participantId));
    expect(anotherParticipant.guestId).toBe(p.guestId);
    expect(await isRecentlyVerified("SRJ01", env.demo.tableQr.B4, "d-skip", at(7200))).toBe(true);
    expect(await isRecentlyVerified("SRJ01", qr, "d-skip", at(12 * 3600 + 2))).toBe(false);
  });

  it("still sends codes in Open mode, but rejects a table that is not ready", async () => {
    await env.db.update(s.diningTables).set({ state: "needs_cleaning" }).where(eq(s.diningTables.id, env.demo.tableIds.B5));
    await failsWith(
      sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.B5, deviceId: "d-state", country: "IN", phone: "9876500070", now: T0 }),
      "table_not_open",
    );
    await env.db.update(s.diningTables).set({ state: "available" }).where(eq(s.diningTables.id, env.demo.tableIds.B5));

    await env.db.update(s.outlets).set({ sessionMode: "open" }).where(eq(s.outlets.id, env.other.outletId));
    const sent = await sendCode({ outletCode: "CNJ01", shortCode: env.other.tableQr, deviceId: "d-state", country: "IN", phone: "9876500070", now: T0 });
    expect(sent.ok).toBe(true);
    await env.db.update(s.outlets).set({ sessionMode: "verified" }).where(eq(s.outlets.id, env.other.outletId));
  });

  it("keeps codes inside their restaurant and table", async () => {
    const sent = await send("T12", "d-iso", "9876500080");
    // The same challenge id at another restaurant's table, or another table here, is unknown
    const elsewhere = await verifyCode({
      outletCode: "CNJ01",
      shortCode: env.other.tableQr,
      deviceId: "d-iso",
      challengeId: sent.challengeId,
      code: sent.devCode,
      name: "Aarav",
      consent: false,
      now: at(1),
    });
    expect(elsewhere).toEqual({ ok: false, error: "expired" });
    expect(await verify("T7", "d-iso", sent.challengeId, sent.devCode, at(1))).toEqual({ ok: false, error: "expired" });
    // Another phone cannot use it either
    expect(await verify("T12", "d-thief", sent.challengeId, sent.devCode, at(1))).toEqual({ ok: false, error: "expired" });
    // The guest record and verification stay in Spice Route's tenant
    expect((await verify("T12", "d-iso", sent.challengeId, sent.devCode, at(2))).ok).toBe(true);
    const otherGuests = await env.db.select().from(s.guests).where(eq(s.guests.tenantId, env.other.tenantId));
    expect(otherGuests).toHaveLength(0);
    const otherJoined = await startOrJoinTable({ outletCode: "CNJ01", shortCode: env.other.tableQr, deviceId: "d-iso", now: at(3) });
    const [otherParticipant] = await env.db.select().from(s.participants).where(eq(s.participants.id, otherJoined.participantId));
    expect(otherParticipant.guestId).toBeNull();
  });
});
