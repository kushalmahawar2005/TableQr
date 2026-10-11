import { readFile } from "node:fs/promises";
import path from "node:path";

// Menu photos saved with MENU_STORAGE_DRIVER=local live in public/uploads. A production server only
// serves the public files that existed when it started, so a photo uploaded later would 404; this
// route reads it from disk instead. Names are random and never reused, so browsers may keep them
// for a year.

const ROOT = path.join(process.cwd(), "public", "uploads");
const TYPES: Record<string, string> = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".avif": "image/avif" };

export async function GET(_req: Request, ctx: RouteContext<"/uploads/[...path]">) {
  const parts = (await ctx.params).path;
  const file = path.join(ROOT, ...parts);
  const type = TYPES[path.extname(file).toLowerCase()];
  // Only image files inside public/uploads, never a path that climbs out of it
  if (!type || !file.startsWith(ROOT + path.sep) || parts.some((p) => p === ".." || p.includes("\0"))) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const body = await readFile(file);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
