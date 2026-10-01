import { randomBytes, randomInt } from "node:crypto";

let lastMs = 0;
let seq = 0;

/**
 * UUIDv7: time-ordered so InnoDB primary keys insert in order, and random enough that ids in
 * URLs cannot be guessed. Monotonic within this process (RFC 9562 method 1): ids made in the
 * same millisecond carry an increasing 12-bit counter, so sorting by id keeps creation order,
 * e.g. the lines of one order stay in the order the guest added them.
 */
export function uuidv7(): string {
  let ms = Date.now();
  if (ms > lastMs) {
    lastMs = ms;
    seq = randomInt(0, 0x800); // random start in the lower half leaves room to count up
  } else {
    seq += 1;
    if (seq > 0xfff) {
      lastMs += 1; // counter exhausted: borrow the next millisecond
      seq = 0;
    }
    ms = lastMs;
  }

  const bytes = randomBytes(16);
  // 48-bit millisecond timestamp, big-endian
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (seq >> 8); // version 7 + counter high bits
  bytes[7] = seq & 0xff;
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
