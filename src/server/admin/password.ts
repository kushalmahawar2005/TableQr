import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (value: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashAdminPassword(password: string) {
  if (password.length < 12) throw new Error("Admin password must be at least 12 characters");
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyAdminPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [kind, n, salt, encoded] = stored.split("$");
  if (kind !== "scrypt" || !salt || !encoded) return false;
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), 32, { ...PARAMS, N: Number(n) });
  const expected = Buffer.from(encoded, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
