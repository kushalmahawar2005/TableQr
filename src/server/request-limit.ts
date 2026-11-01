import "server-only";
import { headers } from "next/headers";
import { AppError } from "./errors";

// A per-worker brake on one network address. Limits sit well above what a busy restaurant's shared
// Wi-Fi sends, and a request with no address is let through: phone and PIN limits still apply.
const windows = new Map<string, { count: number; endsAt: number }>();
const MAX_TRACKED = 10_000;

export function overLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const current = windows.get(key);
  if (current && current.endsAt > now) return ++current.count > limit;
  if (windows.size >= MAX_TRACKED) {
    for (const [tracked, window] of windows) if (window.endsAt <= now) windows.delete(tracked);
    if (windows.size >= MAX_TRACKED) windows.clear();
  }
  windows.set(key, { count: 1, endsAt: now + windowMs });
  return false;
}

async function clientAddress() {
  try {
    const list = await headers();
    return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim() || null;
  } catch {
    return null;
  }
}

export async function limitByClient(action: string, limit: number, windowMs = 60_000) {
  const address = await clientAddress();
  if (address && overLimit(`${action}:${address}`, limit, windowMs)) throw new AppError("rate_limited", "Too many requests. Try again in a minute.");
}

/** Every code costs money, so one address cannot ask for many across restaurants or numbers */
export async function limitSmsByClient() {
  await limitByClient("sms", 10);
  await limitByClient("sms-hour", 60, 3_600_000);
}
