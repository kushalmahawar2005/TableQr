import { readRiderDocument } from "@/server/delivery/rider-docs";
import { AppError } from "@/server/errors";
import { staffFor } from "@/server/staff/request";

// A rider's Aadhaar photo, decrypted for an owner or manager of the same restaurant. Never cached.
export async function GET(_req: Request, ctx: RouteContext<"/console/team/rider-doc/[userId]/[side]">) {
  const { userId, side } = await ctx.params;
  if (side !== "front" && side !== "back") return new Response("Not found", { status: 404 });
  try {
    const bytes = await readRiderDocument(await staffFor(["owner", "manager"], "team"), userId, side);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Not available", { status: e instanceof AppError && e.code === "forbidden" ? 403 : 404 });
  }
}
