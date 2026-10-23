import { NextResponse, type NextRequest } from "next/server";
import { outletCodeForCustomDomain } from "@/server/guest/custom-domain";

/** Route only an owner-enabled, DNS-verified custom-domain root; app assets and QR paths pass through. */
export async function proxy(request: NextRequest) {
  const host = request.nextUrl.hostname || request.headers.get("host") || "";
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") return NextResponse.next();

  const configuredHosts = [process.env.PUBLIC_APP_URL, process.env.NEXT_PUBLIC_APP_URL]
    .flatMap((origin) => { try { return origin ? [new URL(origin).hostname.toLowerCase()] : []; } catch { return []; } });
  if (configuredHosts.includes(host)) return NextResponse.next();

  const outletCode = await outletCodeForCustomDomain(host);
  if (!outletCode) return NextResponse.next();
  const destination = request.nextUrl.clone();
  destination.pathname = `/r/${encodeURIComponent(outletCode)}`;
  return NextResponse.rewrite(destination);
}

export const config = { matcher: "/" };
