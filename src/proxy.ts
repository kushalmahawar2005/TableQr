import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { outletCodeForCustomDomain } from "@/server/guest/custom-domain";

/** Apply a per-request CSP nonce and route an owner-enabled custom-domain root. */
export async function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://sdk.cashfree.com${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://*.cashfree.com",
    "form-action 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response: NextResponse | undefined;
  const host = (request.nextUrl.hostname || request.headers.get("host") || "").toLowerCase();
  const isLocal = !host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";

  // Custom-domain routing only applies to its root. Avoid a database lookup for every other path.
  if (!isLocal && request.nextUrl.pathname === "/") {
    const configuredHosts = [process.env.PUBLIC_APP_URL, process.env.NEXT_PUBLIC_APP_URL]
      .flatMap((origin) => { try { return origin ? [new URL(origin).hostname.toLowerCase()] : []; } catch { return []; } });
    if (!configuredHosts.includes(host)) {
      const outletCode = await outletCodeForCustomDomain(host);
      if (outletCode) {
        const destination = request.nextUrl.clone();
        destination.pathname = `/r/${encodeURIComponent(outletCode)}`;
        response = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
      }
    }
  }

  response ??= NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|uploads|staff-icon).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
