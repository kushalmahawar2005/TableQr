import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { photoBucket } from "../menu-storage";
import { AppError } from "../errors";
import { publicBroadcastUrl } from "@/domain/broadcast";

/** Re-encode untrusted image bytes; Meta image template headers accept JPG/PNG. */
export async function storeBroadcastPhoto(tenantId: string, file: File) {
  if (!file.size || file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AppError("invalid_state", "Choose a JPG, PNG or WebP photo up to 2 MB.");
  let bytes: Buffer;
  try { bytes = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer(); }
  catch { throw new AppError("invalid_state", "This image could not be opened. Choose a JPG or PNG."); }
  const key = `broadcasts/${tenantId}/${randomUUID()}.jpg`;
  const bucket = photoBucket();
  if (bucket) {
    const url = `${bucket.publicBase}/${key}`;
    try { publicBroadcastUrl(url); } catch { throw new AppError("invalid_state", "Configure a public HTTPS image-storage address first."); }
    await bucket.client.send(new PutObjectCommand({ Bucket: bucket.name, Key: key, Body: bytes, ContentType: "image/jpeg", CacheControl: "public,max-age=31536000,immutable" }));
    return url;
  }
  if (process.env.MENU_STORAGE_DRIVER !== "local") throw new AppError("invalid_state", "Photo storage is not configured.");
  const base = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  let url: string;
  try { url = publicBroadcastUrl(new URL(`/uploads/${key}`, base).href); } catch { throw new AppError("invalid_state", "Uploaded broadcast photos need a public HTTPS app address."); }
  const destination = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return url;
}
