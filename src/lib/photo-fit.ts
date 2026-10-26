import sharp from "sharp";

// Menu photos at a fixed weight: the dish sheet copy near 100 KB and the list copy near 30 KB.
// Shared by uploads (src/server/menu-storage.ts) and the library photo script.

/** Whatever the owner uploads, the full photo ends up near 100 KB and the list copy near 30 KB */
export const FULL = { sizes: [1400, 1200, 1000, 800], maxBytes: 100 * 1024 };
export const SMALL = { sizes: [480, 400], maxBytes: 30 * 1024 };
const QUALITIES = [80, 72, 64, 56];
/** Shortest side a menu photo needs to look sharp on a phone */
export const MIN_SIDE = 300;

/** The largest, sharpest WebP within the byte budget: lower quality first, then fewer pixels */
export async function fitWebp(bytes: Buffer, target: { sizes: number[]; maxBytes: number }) {
  let out: Buffer | null = null;
  for (const size of target.sizes) {
    const resized = await sharp(bytes).rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).toBuffer();
    for (const quality of QUALITIES) {
      out = await sharp(resized).webp({ quality, effort: 5 }).toBuffer();
      if (out.byteLength <= target.maxBytes) return out;
    }
  }
  return out!;
}

