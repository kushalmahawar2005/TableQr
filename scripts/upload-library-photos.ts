// Uploads the photo team's dish photos to the menu library.
//
//   npx tsx --env-file=.env.local scripts/upload-library-photos.ts <folder> [--dry-run]
//
// Every file must be named after the dish (tomato-soup.png). Each photo is turned into the
// same two WebP copies as an owner's upload (near 100 KB and a 30 KB list copy), stored under
// library/ in the photo bucket, and recorded in src/domain/menu-library/photos.json. Names that
// match no library dish are listed and skipped. Running it again replaces a dish's photo.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { FULL, MIN_SIDE, SMALL, fitWebp } from "../src/lib/photo-fit";
import { LIBRARY } from "../src/domain/menu-library/data";
import { photoSlug } from "../src/domain/menu-library/photos";

const [folder, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (!folder) {
  console.error("Usage: tsx --env-file=.env.local scripts/upload-library-photos.ts <folder> [--dry-run]");
  process.exit(1);
}

const bucket = process.env.MENU_STORAGE_BUCKET, endpoint = process.env.MENU_STORAGE_ENDPOINT;
if (!dryRun && (process.env.MENU_STORAGE_DRIVER === "local" || !bucket || !endpoint)) {
  console.error("Set MENU_STORAGE_BUCKET and MENU_STORAGE_ENDPOINT (and keys) to upload; --dry-run only checks names.");
  process.exit(1);
}
const client = dryRun ? null : new S3Client({
  endpoint,
  region: process.env.MENU_STORAGE_REGION || "auto",
  forcePathStyle: process.env.MENU_STORAGE_FORCE_PATH_STYLE === "1",
  credentials: { accessKeyId: process.env.MENU_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.MENU_STORAGE_SECRET_ACCESS_KEY! },
});

const known = new Set(LIBRARY.flatMap((c) => c.items.map((line) => photoSlug(line.split("|")[0]))));
const mapFile = path.join(process.cwd(), "src/domain/menu-library/photos.json");
const map: Record<string, string> = JSON.parse(readFileSync(mapFile, "utf8"));

const files = readdirSync(folder).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith("."));
const unknown: string[] = [], tooSmall: string[] = [], failed: string[] = [];
let done = 0;

async function one(file: string) {
  const slug = path.parse(file).name.toLowerCase();
  if (!known.has(slug)) { unknown.push(file); return; }
  const bytes = readFileSync(path.join(folder, file));
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE) { tooSmall.push(file); return; }
  if (dryRun) { done++; return; }
  // The content hash in the name means a replaced photo never shows an old cached copy
  const key = `library/${slug}.${createHash("sha1").update(bytes).digest("hex").slice(0, 8)}.webp`;
  // Already uploaded from this exact file: nothing to do
  if (map[slug] === key) { done++; return; }
  const [full, small] = await Promise.all([fitWebp(bytes, FULL), fitWebp(bytes, SMALL)]);
  const put = async (Key: string, Body: Buffer) => {
    // A dropped connection is retried a few times before the photo is reported as failed
    for (let attempt = 1; ; attempt++) {
      try { return await client!.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType: "image/webp", CacheControl: "public,max-age=31536000,immutable" })); }
      catch (err) { if (attempt >= 4) throw err; await new Promise((r) => setTimeout(r, attempt * 2000)); }
    }
  };
  try {
    await put(key, full);
    await put(key.replace(/\.webp$/, "-sm.webp"), small);
  } catch {
    failed.push(file);
    return;
  }
  map[slug] = key;
  done++;
  if (done % 10 === 0) console.log(`  ${done} uploaded…`);
}

async function main() {
  // A few at a time, so a slow connection does not time out
  const queue = [...files];
  await Promise.all(Array.from({ length: 3 }, async () => { for (let f = queue.shift(); f; f = queue.shift()) await one(f); }));
  report();
}

function report() {
if (!dryRun) writeFileSync(mapFile, JSON.stringify(Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
console.log(`${dryRun ? "Checked" : "Uploaded"} ${done} of ${files.length} photos. Library now has ${Object.keys(map).length} photos.`);
if (unknown.length) console.log(`Not a library dish (check the name): ${unknown.join(", ")}`);
if (tooSmall.length) console.log(`Too small (under ${MIN_SIDE} px): ${tooSmall.join(", ")}`);
if (failed.length) console.log(`Could not upload (run again to retry): ${failed.join(", ")}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
