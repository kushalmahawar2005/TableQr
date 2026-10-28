import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { outletCodeForCustomDomain } from "@/server/guest/custom-domain";
import { requestHostname } from "@/server/request-host";

/** Apply a per-request CSP nonce and safely route owner-enabled custom guest domains. */
export async function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const host = requestHostname(request.headers, request.nextUrl.hostname);
  const isLocal = !host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://sdk.cashfree.com${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    `frame-src 'self' https://*.cashfree.com${request.nextUrl.pathname === "/console/broadcasts" ? " https://www.facebook.com https://web.facebook.com" : ""}`,
    "form-action 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    // A production build run on localhost has no HTTPS to upgrade to
    ...(isDevelopment || isLocal ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response: NextResponse | undefined;

  if (!isLocal) {
    const configuredHosts = [process.env.PUBLIC_APP_URL, process.env.NEXT_PUBLIC_APP_URL]
      .flatMap((origin) => { try { return origin ? [new URL(origin).hostname.toLowerCase()] : []; } catch { return []; } });
    if (!configuredHosts.includes(host)) {
      const domainState = await outletCodeForCustomDomain(host);
      const fallbackOrigin = [process.env.PUBLIC_APP_URL, process.env.NEXT_PUBLIC_APP_URL]
        .map((origin) => { try { return origin ? new URL(origin).origin : null; } catch { return null; } })
        .find((origin): origin is string => !!origin);

      if (!domainState) {
        if (fallbackOrigin) {
          const fallback = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, fallbackOrigin);
          response = NextResponse.redirect(fallback, 307);
        } else {
          response = new NextResponse("This host is not configured for Tableeqr.", { status: 421 });
        }
      } else {
        const destination = request.nextUrl.clone();
        if (destination.pathname === "/") {
          destination.pathname = `/r/${encodeURIComponent(domainState)}`;
          response = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
        } else if (destination.pathname === "/r" || destination.pathname.startsWith("/r/")) {
          const suffix = destination.pathname === "/r" ? "" : destination.pathname.replace(/^\/r\/[^/]+/, "");
          destination.pathname = `/r/${encodeURIComponent(domainState)}${suffix}`;
          response = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
        } else if (fallbackOrigin) {
          const fallback = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, fallbackOrigin);
          response = NextResponse.redirect(fallback, 307);
        } else {
          response = new NextResponse("This host is not configured for Tableeqr.", { status: 421 });
        }
      }
    }
  }

  // The restaurant's installed app lives under /r/CODE/app, so its scope never covers the table QRs
  // (/r/CODE/t/...): a dine-in guest scanning a table stays in the browser. The app's pages are the
  // ordinary guest pages; they learn their link base from this header.
  const app = !response && /^\/r\/([^/]+)\/app(\/.*)?$/.exec(request.nextUrl.pathname);
  if (app && !(app[2] ?? "").startsWith("/t/") && app[2] !== "/app.webmanifest") {
    const destination = request.nextUrl.clone();
    destination.pathname = `/r/${app[1]}${app[2] ?? ""}`;
    requestHeaders.set("x-guest-base", `/r/${app[1]}/app`);
    response = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
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
