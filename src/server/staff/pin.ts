import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Staff PINs are 4 digits, so the hash is slow (scrypt) and attempts are rate-limited (auth.ts).

const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

export const isPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{4}$/.test(pin);

export async function hashPin(pin: string): Promise<string> {
  if (!isPin(pin)) throw new Error("A staff PIN is 4 digits");
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  // Same work whether or not the user exists, so timing does not tell which phones are staff
  const [kind, n, salt, hash] = (stored ?? "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$").split("$");
  if (kind !== "scrypt" || !isPin(pin)) return false;
  const expected = Buffer.from(hash ?? "", "base64url");
  const actual = await scrypt(pin, Buffer.from(salt, "base64url"), 32, { ...PARAMS, N: Number(n) });
  return expected.length === actual.length && stored !== null && timingSafeEqual(expected, actual);
}
