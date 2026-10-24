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
