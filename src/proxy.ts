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
    "frame-src 'self' https://*.cashfree.com",
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
  // Guest page a custom domain maps to, before the installed-app rewrite below
  let guestPath: string | null = null;

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
        const pathname = request.nextUrl.pathname;
        if (pathname === "/") {
          guestPath = `/r/${encodeURIComponent(domainState)}`;
        } else if (pathname === "/r" || pathname.startsWith("/r/")) {
          const suffix = pathname === "/r" ? "" : pathname.replace(/^\/r\/[^/]+/, "");
          guestPath = `/r/${encodeURIComponent(domainState)}${suffix}`;
        } else if (SAME_ORIGIN_FILES.has(pathname)) {
          // Served from this host: browsers refuse a redirected worker script (see SAME_ORIGIN_FILES)
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
  const app = !response && /^\/r\/([^/]+)\/app(\/.*)?$/.exec(guestPath ?? request.nextUrl.pathname);
  if (app && !(app[2] ?? "").startsWith("/t/") && app[2] !== "/app.webmanifest") {
    guestPath = `/r/${app[1]}${app[2] ?? ""}`;
    requestHeaders.set("x-guest-base", `/r/${app[1]}/app`);
  }
  if (!response && guestPath !== null) {
    const destination = request.nextUrl.clone();
    destination.pathname = guestPath;
    response = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
  }

  response ??= NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Root files a custom guest domain serves itself instead of redirecting to the Tableeqr address:
 * the service worker, and the user-independent offline shell its install step caches (a redirected
 * fetch there fails the install, which blocks push alerts and installing the guest app).
 */
const SAME_ORIGIN_FILES = new Set(["/sw.js", "/offline-pos"]);

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|uploads|staff-icon).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    // Prefetches of the installed guest app's pages need the /app rewrite too, or they 404
    "/r/:outlet/app/:path*",
  ],
};
