"use server";
import { AppError } from "@/server/errors";
import { joinPublicWaitlist, leavePublicWaitlist, publicWaitlistStatus } from "@/server/booking/waitlist";
const fail = (e: unknown) => ({ ok: false as const, message: e instanceof AppError ? e.message : "That did not go through." });
export async function joinWaitlistAction(outlet: string, input: { name: string; phone: string; partySize: number; seatingPreference: string }) { try { return { ok: true as const, data: await joinPublicWaitlist(outlet, input) }; } catch (e) { return fail(e); } }
export async function waitlistStatusAction(outlet: string, token: string) { try { return { ok: true as const, data: await publicWaitlistStatus(outlet, token) }; } catch (e) { return fail(e); } }
export async function leaveWaitlistAction(outlet: string, token: string) { try { return { ok: true as const, data: await leavePublicWaitlist(outlet, token) }; } catch (e) { return fail(e); } }
