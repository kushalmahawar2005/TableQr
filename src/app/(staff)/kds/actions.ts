"use server";
import { cookies } from "next/headers";
import { AppError } from "@/server/errors";
import { KDS_COOKIE, KDS_DEVICE_DAYS, kdsSetupOptions, requireKdsDevice, revokeKdsDevice, setupKdsDevice, updateKdsDevice } from "@/server/kitchen/device";
import { recordPrintJob } from "@/server/print/jobs";
import { printSetup } from "@/server/print/printers";
import { kdsAccept, kdsBoard, kdsOlder, kdsBumpLine, kdsBumpTicket, kdsCancelLine, kdsRealtimeToken, kdsRecall, kdsSearch, kdsStart, kdsStock } from "@/server/kitchen/kds";

// S2 server actions. The screen, its outlet and its station come from the httpOnly device cookie;
// the client sends only ids and values. Setup and settings need a manager or owner PIN.

export type KdsResult<T = undefined> = { ok: true; data: T } | { ok: false; code: string; message: string; reason?: string };

const token = async () => (await cookies()).get(KDS_COOKIE)?.value ?? null;
const device = async () => requireKdsDevice(await token());

function fail(err: unknown): { ok: false; code: string; message: string; reason?: string } {
  if (err instanceof AppError) return { ok: false, code: err.code, message: err.message, reason: (err.details?.reason as string | undefined) ?? undefined };
  console.error("[kds] action failed", err);
  return { ok: false, code: "failed", message: "That didn't go through. Try again." };
}

async function run<T>(work: () => Promise<T>): Promise<KdsResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (err) {
    return fail(err);
  }
}

const lang = (v: unknown) => (v === "hi" ? "hi" : "en") as "en" | "hi";
const creds = (outlet: string, phone: string, pin: string) => ({
  outletCode: String(outlet ?? "").trim().toUpperCase().slice(0, 12),
  phone: String(phone ?? "").slice(0, 20),
  pin: String(pin ?? "").slice(0, 8),
});

export async function setupOptionsAction(outlet: string, phone: string, pin: string) {
  return run(() => kdsSetupOptions(creds(outlet, phone, pin)));
}

export async function setupAction(outlet: string, phone: string, pin: string, station: string | null, expeditor: boolean, language: string) {
  return run(async () => {
    const res = await setupKdsDevice({ ...creds(outlet, phone, pin), station: station ? String(station) : null, expeditor: expeditor === true, lang: lang(language) });
    (await cookies()).set(KDS_COOKIE, res.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/kds",
      maxAge: KDS_DEVICE_DAYS * 86400,
    });
    return undefined;
  });
}

export async function boardAction(station: string | null) {
  return run(async () => kdsBoard(await device(), station ? String(station) : null));
}

export async function olderAction(station: string | null, offset: number, limit: number) {
  return run(async () => kdsOlder(await device(), station ? String(station) : null, Number(offset) || 0, Number(limit) || 12));
}

export async function kdsTokenAction() {
  try {
    return kdsRealtimeToken(await device());
  } catch {
    return null;
  }
}

export const acceptAction = async (ticketId: string) => run(async () => kdsAccept(await device(), ticketId));
export const startAction = async (ticketId: string) => run(async () => kdsStart(await device(), ticketId));
export const bumpTicketAction = async (ticketId: string) => run(async () => kdsBumpTicket(await device(), ticketId));
export const bumpLineAction = async (lineId: string) => run(async () => kdsBumpLine(await device(), lineId));
export const recallAction = async (ticketId: string) => run(async () => kdsRecall(await device(), ticketId));
/** Cancel one item, even after accept: a reason, and a manager or owner PIN */
export const cancelLineAction = async (lineId: string, reason: string, phone: string, pin: string) => run(async () => kdsCancelLine(await device(), { lineId, reason, phone, pin }));
export const stockAction = async (itemId: string, outOfStock: boolean) =>
  run(async () => {
    const res = await kdsStock(await device(), itemId, outOfStock === true);
    return { cartsAffected: res.cartsAffected };
  });
export const searchAction = async (q: string) => run(async () => kdsSearch(await device(), String(q ?? "")));

export async function settingsAction(phone: string, pin: string, station: string | null, expeditor: boolean, language: string) {
  return run(async () => {
    const t = await token();
    if (!t) throw new AppError("staff_signed_out", "This kitchen screen needs to be set up again by a manager.");
    await updateKdsDevice(t, { phone: String(phone ?? "").slice(0, 20), pin: String(pin ?? "").slice(0, 8), station: station ? String(station) : null, expeditor: expeditor === true, lang: lang(language) });
    return undefined;
  });
}

export async function logoutAction(phone: string, pin: string) {
  return run(async () => {
    const t = await token();
    if (t) await revokeKdsDevice(t, { phone: String(phone ?? "").slice(0, 20), pin: String(pin ?? "").slice(0, 8) });
    (await cookies()).delete({ name: KDS_COOKIE, path: "/kds" });
    return undefined;
  });
}

// Printing from a kitchen wall screen: its outlet comes from the device cookie, and a device may only
// report kitchen tickets.
export async function printSetupAction() {
  return run(async () => printSetup(await device()));
}

export async function recordPrintAction(report: Parameters<typeof recordPrintJob>[1]) {
  try {
    const d = await device();
    return { ok: true as const, data: await recordPrintJob({ tenantId: d.tenantId, outletId: d.outletId, roles: [], userId: null, deviceId: d.deviceId }, report) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false as const, message: err.message, refused: true as const };
    throw err;
  }
}
