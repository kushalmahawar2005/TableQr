import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AppError } from "./errors";
import { FULL, MIN_SIDE, SMALL, fitWebp } from "@/lib/photo-fit";

// Menu photos. MENU_STORAGE_DRIVER=local keeps them under public/uploads (fine on one machine, but
// a redeploy can wipe them); anything else puts them in an S3-compatible bucket such as
// Cloudflare R2, served from MENU_STORAGE_PUBLIC_URL. Each photo is kept twice: full size for the
// dish sheet and a 480 px "-sm" copy for lists (see src/domain/menu-photo.ts).

export type MenuImageUpload = { tenantId: string; brandId: string; filename: string; contentType: string; bytes: Buffer };

const CACHE = "public,max-age=31536000,immutable";
const smallKeyOf = (key: string) => key.replace(/\.webp$/, "-sm.webp");

type Bucket = { client: S3Client; name: string; publicBase: string };

/** The configured bucket, or null when photos stay on this machine */
export function photoBucket(): Bucket | null {
  if (process.env.MENU_STORAGE_DRIVER === "local") return null;
  const name = process.env.MENU_STORAGE_BUCKET;
  const endpoint = process.env.MENU_STORAGE_ENDPOINT;
  if (!name || !endpoint) return null;
  const accessKeyId = process.env.MENU_STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MENU_STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const client = new S3Client({
    endpoint,
    region: process.env.MENU_STORAGE_REGION || "auto",
    forcePathStyle: process.env.MENU_STORAGE_FORCE_PATH_STYLE === "1",
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  const publicBase = (process.env.MENU_STORAGE_PUBLIC_URL || `${endpoint.replace(/\/$/, "")}/${name}`).replace(/\/$/, "");
  return { client, name, publicBase };
}

const put = (b: Bucket, key: string, body: Buffer) => b.client.send(new PutObjectCommand({ Bucket: b.name, Key: key, Body: body, ContentType: "image/webp", CacheControl: CACHE }));

export async function storeMenuImage(input: MenuImageUpload) {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(input.contentType)) throw new AppError("invalid_state", "Upload a JPG, PNG, WebP, or AVIF image.");
  if (input.bytes.byteLength > 5 * 1024 * 1024) throw new AppError("invalid_state", "Images must be 5 MB or smaller.");
  // A thumbnail blown up on the dish sheet looks blurry: ask for a real photo instead
  const meta = await sharp(input.bytes).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new AppError("invalid_state", "This file is not a photo we can read. Use a JPG, PNG or WebP.");
  if (Math.min(meta.width, meta.height) < MIN_SIDE) {
    throw new AppError("invalid_state", `This photo is too small (${meta.width}×${meta.height} px) and would look blurry. Use one at least ${MIN_SIDE} px wide. From Google, open the photo full size first, then save it.`, { reason: "too_small" });
  }
  const key = `menus/${input.tenantId}/${input.brandId}/${randomUUID()}.webp`;
  const webp = await fitWebp(input.bytes, FULL);
  const small = await fitWebp(input.bytes, SMALL);
  if (process.env.MENU_STORAGE_DRIVER === "local") {
    const file = path.join(process.cwd(), "public", "uploads", key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, webp);
    await writeFile(path.join(process.cwd(), "public", "uploads", smallKeyOf(key)), small);
    return { key, url: `/uploads/${key}` };
  }
  const bucket = photoBucket();
  if (!bucket) throw new AppError("invalid_state", "Menu image storage is not configured for this environment.");
  await put(bucket, key, webp);
  await put(bucket, smallKeyOf(key), small);
  return { key, url: `${bucket.publicBase}/${key}` };
}

/** Bank-issued payment QRs retain sharp edges; never run them through the lossy menu-photo budget. */
export async function storePaymentQr(input: MenuImageUpload) {
  if (!/^image\/(jpeg|png|webp)$/.test(input.contentType) || input.bytes.byteLength > 5 * 1024 * 1024) throw new AppError("invalid_state", "Choose a JPG, PNG or WebP payment QR up to 5 MB.");
  const meta = await sharp(input.bytes, { limitInputPixels: 25_000_000 }).metadata().catch(() => null);
  if (!meta?.width || !meta.height || Math.min(meta.width, meta.height) < 200) throw new AppError("invalid_state", "Use a clear payment QR image at least 200 px wide.");
  const bytes = await sharp(input.bytes, { limitInputPixels: 25_000_000 }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).webp({ lossless: true }).toBuffer();
  const key = `payment-qr/${input.tenantId}/${input.brandId}/${randomUUID()}.webp`;
  if (process.env.MENU_STORAGE_DRIVER === "local") {
    const file = path.join(process.cwd(), "public", "uploads", key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return { url: `/uploads/${key}` };
  }
  const bucket = photoBucket();
  if (!bucket) throw new AppError("invalid_state", "Image storage is not configured.");
  await put(bucket, key, bytes);
  return { url: `${bucket.publicBase}/${key}` };
}

export async function removeLocalMenuImage(url: string | null | undefined) {
  if (!url?.startsWith("/uploads/")) return;
  for (const u of [url, smallKeyOf(url)]) {
    try {
      await unlink(path.join(process.cwd(), "public", u.replace(/^\//, "")));
    } catch {
      /* old image (or its small copy) may already be gone */
    }
  }
}

type Sql = { query: (sql: string, values?: unknown[]) => Promise<unknown> };

/**
 * Once a bucket is set up, photos still saved on this machine move into it and the menu points at
 * the bucket. Safe to run at every start: only "/uploads/..." addresses whose file is still here
 * are moved; the rest are left as they are.
 */
export async function movePhotosToBucket(sql: Sql, root = process.cwd()) {
  const bucket = photoBucket();
  if (!bucket) return { moved: 0, missing: 0 };
  let moved = 0;
  let missing = 0;
  for (const table of ["menu_items", "menu_categories", "brands"] as const) {
    const column = table === "brands" ? "logo_url" : "image_url";
    const [rows] = (await sql.query(`select id, ${column} as url from ${table} where ${column} like '/uploads/%'`)) as [{ id: string; url: string }[]];
    for (const row of rows) {
      const key = row.url.replace(/^\/uploads\//, "");
      if (key.includes("..")) continue;
      const file = path.join(root, "public", "uploads", key);
      let full: Buffer;
      try {
        full = await readFile(file);
      } catch {
        missing++;
        continue;
      }
      await put(bucket, key, full);
      const small = await readFile(smallKeyOf(file)).catch(() => null);
      if (small) await put(bucket, smallKeyOf(key), small);
      await sql.query(`update ${table} set ${column} = ? where id = ? and ${column} = ?`, [`${bucket.publicBase}/${key}`, row.id, row.url]);
      moved++;
    }
  }
  return { moved, missing };
}
