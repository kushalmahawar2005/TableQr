/** Resolve the public request host when the app runs behind a reverse proxy. */
export function requestHostname(headers: Pick<Headers, "get">, fallbackHostname: string): string {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const rawHost = forwardedHost || headers.get("host")?.trim() || fallbackHostname;

  try {
    return new URL(`http://${rawHost}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The origin the visitor is on right now: a restaurant's own domain or the main app address.
 * Payment return addresses use it so the guest comes back to the same site, where their device
 * cookie lives. Anything but a local address is https, which Cashfree requires.
 */
export function requestOrigin(headers: Pick<Headers, "get">, fallbackHost = "localhost:3000"): string {
  const raw = headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || headers.get("host")?.trim() || fallbackHost;
  let url: URL;
  try { url = new URL(`http://${raw}`); } catch { url = new URL(`http://${fallbackHost}`); }
  if (url.hostname === "0.0.0.0") url.hostname = "localhost";
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.startsWith("127.");
  const proto = local ? (headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https" ? "https" : "http") : "https";
  return `${proto}://${url.host}`;
}
