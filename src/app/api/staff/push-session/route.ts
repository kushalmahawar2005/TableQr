import { currentStaff } from "@/server/staff/request";
import { currentRider } from "@/server/staff/rider-request";

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "X-Robots-Tag": "noindex",
};

export const dynamic = "force-dynamic";

/** Confirms that a queued staff push still belongs to this browser's active staff session. */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!sessionId || sessionId.length > 36) return Response.json({ active: false }, { headers });

  const [staff, rider] = await Promise.all([currentStaff(), currentRider()]);
  return Response.json({ active: staff?.sessionId === sessionId || rider?.sessionId === sessionId }, { headers });
}
