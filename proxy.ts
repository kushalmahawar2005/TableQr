import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";

/** Route only the verified custom-domain root; all app assets, APIs and existing QR paths pass through. */
export async function proxy(request: NextRequest) {
  const rawHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host") ?? "";
  let host = "";
  try { host = new URL(`http://${rawHost}`).hostname.toLowerCase(); } catch { return NextResponse.next(); }
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") return NextResponse.next();

  const configuredHosts = [process.env.PUBLIC_APP_URL, process.env.NEXT_PUBLIC_APP_URL]
    .flatMap((origin) => { try { return origin ? [new URL(origin).hostname.toLowerCase()] : []; } catch { return []; } });
  if (configuredHosts.includes(host)) return NextResponse.next();

  const [outlet] = await db.select({ code: s.outlets.code }).from(s.outlets)
    .where(and(eq(s.outlets.customDomain, host), isNotNull(s.outlets.customDomainVerifiedAt))).limit(1);
  if (!outlet) return NextResponse.next();
  const destination = request.nextUrl.clone();
  destination.pathname = `/r/${encodeURIComponent(outlet.code)}`;
  return NextResponse.rewrite(destination);
}

export const config = { matcher: "/" };
