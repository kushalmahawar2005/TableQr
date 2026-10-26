import "server-only";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { photoBucket } from "../menu-storage";

// TableQR's own Android apps. The platform admin uploads each version; the download page
// always offers the newest. Files live in the public bucket under apps/<app>/.

export type AppName = (typeof s.appReleases.app.enumValues)[number];
const MAX_BYTES = 150 * 1024 * 1024;

export async function appReleases(app: AppName) {
  return db.select().from(s.appReleases).where(eq(s.appReleases.app, app)).orderBy(desc(s.appReleases.createdAt));
}

export async function latestRelease(app: AppName) {
  const [row] = await db.select().from(s.appReleases).where(eq(s.appReleases.app, app)).orderBy(desc(s.appReleases.createdAt)).limit(1);
  return row ?? null;
}

/** A new version: the APK goes to the bucket, then the version is listed (newest wins) */
export async function addRelease(input: { app: AppName; version: string; notes: string; bytes: Buffer }) {
  const version = String(input.version ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){0,2}$/.test(version)) throw new AppError("invalid_state", "Version looks like 1.0.1");
  if (input.bytes.byteLength < 100_000 || input.bytes.byteLength > MAX_BYTES) throw new AppError("invalid_state", "Upload the .apk file (up to 150 MB).");
  // Every APK is a ZIP: it starts with PK
  if (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b) throw new AppError("invalid_state", "This is not an APK file.");
  const [dupe] = await db.select({ id: s.appReleases.id }).from(s.appReleases).where(eq(s.appReleases.version, version));
  if (dupe) throw new AppError("invalid_state", `Version ${version} is already uploaded. Use a higher number.`);
  const bucket = photoBucket();
  if (!bucket) throw new AppError("invalid_state", "File storage is not set up on this server.");
  const key = `apps/${input.app}/TableQR-Rider-${version}.apk`;
  await bucket.client.send(new PutObjectCommand({ Bucket: bucket.name, Key: key, Body: input.bytes, ContentType: "application/vnd.android.package-archive", ContentDisposition: 'attachment; filename="TableQR-Rider.apk"', CacheControl: "public,max-age=31536000,immutable" }));
  await db.insert(s.appReleases).values({ app: input.app, version, url: `${bucket.publicBase}/${key}`, sizeBytes: input.bytes.byteLength, notes: String(input.notes ?? "").trim().slice(0, 300) || null });
  return latestRelease(input.app);
}
