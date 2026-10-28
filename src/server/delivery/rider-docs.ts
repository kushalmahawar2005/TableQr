import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { photoBucket } from "../menu-storage";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";

// Rider identity check (phase 3). Aadhaar photos are shrunk, stripped of EXIF and encrypted
// with AES-256-GCM before they leave the server; the bucket only ever holds ciphertext, and only
// an owner or manager of the same restaurant can view them, through the server. The full Aadhaar
// number is never asked for or stored: only its last four digits.

const reviewers = ["owner", "manager"] as const;

/** A key for documents only, derived from the server's credential key */
function docKey() {
  const raw = process.env.PAYMENT_CREDENTIALS_KEY?.trim() ?? "";
  if (!/^[\da-fA-F]{64}$/.test(raw)) throw new AppError("invalid_state", "Document storage is not set up on the server yet. Ask Tableeqr support.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(raw, "hex"), Buffer.alloc(0), "tableqr-rider-documents-v1", 32));
}

export function sealDocument(plain: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", docKey(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function unsealDocument(sealed: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", docKey(), sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

/** Local development keeps documents outside public/, so nothing can serve them directly */
const localPath = (key: string) => path.join(process.cwd(), ".private-uploads", key);

async function putSealed(tenantId: string, bytes: Buffer) {
  const key = `private/rider-docs/${tenantId}/${randomUUID()}.bin`;
  const body = sealDocument(bytes);
  const bucket = photoBucket();
  if (!bucket) { await mkdir(path.dirname(localPath(key)), { recursive: true }); await writeFile(localPath(key), body); }
  else await bucket.client.send(new PutObjectCommand({ Bucket: bucket.name, Key: key, Body: body, ContentType: "application/octet-stream", CacheControl: "private, no-store" }));
  return key;
}
async function getSealed(key: string) {
  const bucket = photoBucket();
  if (!bucket) return readFile(localPath(key));
  const res = await bucket.client.send(new GetObjectCommand({ Bucket: bucket.name, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}
async function dropSealed(key: string | null) {
  if (!key) return;
  const bucket = photoBucket();
  if (!bucket) await unlink(localPath(key)).catch(() => undefined);
  else await bucket.client.send(new DeleteObjectCommand({ Bucket: bucket.name, Key: key })).catch(() => undefined);
}

/** Readable, small, and with no location or camera data */
async function cleanPhoto(file: { bytes: Buffer; contentType: string }) {
  if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.contentType)) throw new AppError("invalid_state", "Upload a photo (JPG or PNG).");
  if (file.bytes.byteLength > 8 * 1024 * 1024) throw new AppError("invalid_state", "Each photo must be 8 MB or smaller.");
  const meta = await sharp(file.bytes).metadata().catch(() => null);
  if (!meta?.width || !meta.height || Math.min(meta.width, meta.height) < 400) throw new AppError("invalid_state", "This photo is too small to read. Take it closer, in good light.");
  return sharp(file.bytes).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}

export type RiderVerification = { status: "none" | "pending" | "verified" | "rejected"; last4: string | null; note: string | null; submittedAt: number | null; hasDocs: boolean };

const view = (row: typeof s.riderDocuments.$inferSelect | undefined): RiderVerification => row
  ? { status: row.status, last4: row.aadhaarLast4, note: row.note, submittedAt: row.submittedAt.getTime(), hasDocs: !!(row.frontKey || row.backKey) }
  : { status: "none", last4: null, note: null, submittedAt: null, hasDocs: false };

async function rowFor(tenantId: string, userId: string) {
  const [row] = await db.select().from(s.riderDocuments).where(and(eq(s.riderDocuments.tenantId, tenantId), eq(s.riderDocuments.userId, userId)));
  return row;
}

export async function myVerification(staff: StaffSession) {
  await requireStaffRole(staff, ["rider"]);
  return view(await rowFor(staff.tenantId, staff.userId));
}

/** The rider sends Aadhaar front and back with the last four digits; their face photo is the selfie */
export async function submitRiderDocuments(staff: StaffSession, input: { last4: string; consent: boolean; front: { bytes: Buffer; contentType: string }; back: { bytes: Buffer; contentType: string } }, now = new Date()) {
  await requireStaffRole(staff, ["rider"]);
  if (!input.consent) throw new AppError("invalid_state", "Tick the box to agree to the check.");
  const last4 = String(input.last4 ?? "").replace(/\D/g, "");
  if (last4.length !== 4) throw new AppError("invalid_state", "Enter only the last 4 digits of your Aadhaar.");
  const [me] = await db.select({ photoUrl: s.users.photoUrl }).from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
  if (!me?.photoUrl) throw new AppError("invalid_state", "Add your face photo in your profile first. It is used as your selfie.");
  const existing = await rowFor(staff.tenantId, staff.userId);
  if (existing?.status === "verified") throw new AppError("invalid_state", "You are already verified.");
  const [front, back] = await Promise.all([cleanPhoto(input.front), cleanPhoto(input.back)]);
  const [frontKey, backKey] = await Promise.all([putSealed(staff.tenantId, front), putSealed(staff.tenantId, back)]);
  const values = { status: "pending" as const, aadhaarLast4: last4, frontKey, backKey, consentAt: now, submittedAt: now, reviewedAt: null, reviewedByUserId: null, note: null };
  if (existing) await db.update(s.riderDocuments).set(values).where(and(eq(s.riderDocuments.tenantId, staff.tenantId), eq(s.riderDocuments.id, existing.id)));
  else await db.insert(s.riderDocuments).values({ tenantId: staff.tenantId, userId: staff.userId, ...values });
  await Promise.all([dropSealed(existing?.frontKey ?? null), dropSealed(existing?.backKey ?? null)]);
  await audit(db, staff, { action: "rider.documents_submitted", entity: "user", entityId: staff.userId, after: { last4 }, now });
  return view(await rowFor(staff.tenantId, staff.userId));
}

/** Owner or manager: a rider's check, for the Team screen */
export async function riderVerificationFor(staff: StaffSession, userId: string) {
  await requireStaffRole(staff, reviewers);
  return view(await rowFor(staff.tenantId, String(userId)));
}

/** The decrypted photo, for an owner or manager of the same restaurant only */
export async function readRiderDocument(staff: StaffSession, userId: string, side: "front" | "back") {
  await requireStaffRole(staff, reviewers);
  const row = await rowFor(staff.tenantId, String(userId));
  const key = side === "front" ? row?.frontKey : row?.backKey;
  if (!key) throw new AppError("not_found", "This photo is not available.");
  return unsealDocument(await getSealed(key));
}

/** Approve or reject. Approving deletes the Aadhaar photos unless asked to keep them. */
export async function reviewRiderDocuments(staff: StaffSession, userId: string, decision: "verified" | "rejected", note: string, keepPhotos = false, now = new Date()) {
  await requireStaffRole(staff, reviewers);
  const row = await rowFor(staff.tenantId, String(userId));
  if (!row || row.status !== "pending") throw new AppError("invalid_state", "There is nothing waiting to be checked for this rider.");
  if (decision !== "verified" && decision !== "rejected") throw new AppError("invalid_state", "Choose verify or reject.");
  const reason = String(note ?? "").trim().slice(0, 200);
  if (decision === "rejected" && reason.length < 3) throw new AppError("invalid_state", "Tell the rider what to fix.");
  const drop = decision === "rejected" || !keepPhotos;
  await db.update(s.riderDocuments).set({ status: decision, note: reason || null, reviewedAt: now, reviewedByUserId: staff.userId, ...(drop ? { frontKey: null, backKey: null } : {}) })
    .where(and(eq(s.riderDocuments.tenantId, staff.tenantId), eq(s.riderDocuments.id, row.id)));
  if (drop) await Promise.all([dropSealed(row.frontKey), dropSealed(row.backKey)]);
  await audit(db, staff, { action: `rider.${decision}`, entity: "user", entityId: row.userId, after: { note: reason || null, photosDeleted: drop }, now });
  return view(await rowFor(staff.tenantId, String(userId)));
}

/** Which of these riders are verified, for badges */
export async function verifiedRiders(tenantId: string, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db.select({ userId: s.riderDocuments.userId }).from(s.riderDocuments)
    .where(and(eq(s.riderDocuments.tenantId, tenantId), inArray(s.riderDocuments.userId, userIds), eq(s.riderDocuments.status, "verified")));
  return new Set(rows.map((r) => r.userId));
}
