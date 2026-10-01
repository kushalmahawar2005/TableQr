// Browser side of realtime (PS 9.3). Screens must change within about two seconds, and phones
// sleep, lose signal and switch networks, so this client:
// - reconnects with backoff, and at once when the tab becomes visible again
// - asks the screen to reload its data after every reconnect (events are hints; missed ones
//   are covered by the reload, never replayed)
// - polls while disconnected, and polls only if realtime is not configured
// - fetches a fresh token when the hub closes a socket whose token expired

export type RealtimeEvent = { topic: string; type: string; data?: Record<string, unknown> };
export type RealtimeStatus = "connecting" | "live" | "offline";

type Options = {
  /** Worker base URL, e.g. wss://realtime.example.com */
  url: string | null;
  /** Fresh signed token from the server; null means realtime is off and we only poll */
  getToken: () => Promise<string | null>;
  onEvents: (events: RealtimeEvent[]) => void;
  /** Reload this screen's data from the server */
  onResync: () => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Polling interval while offline */
  pollMs?: number;
  heartbeatMs?: number;
};

const TOKEN_EXPIRED = 4001;

/** Seconds-since-epoch expiry from a token's claims, or null if unreadable */
function tokenExpiry(token: string): number | null {
  try {
    const b64 = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4))).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

export function connectRealtime(opts: Options): () => void {
  const pollMs = opts.pollMs ?? 15_000;
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let connectedOnce = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (s: RealtimeStatus) => opts.onStatus?.(s);

  /** Swap to a fresh token: drop the current socket on purpose and open a new one */
  const rotate = () => {
    const old = ws;
    ws = null; // the old socket's close handler sees it is no longer current and stays quiet
    clearInterval(heartbeat);
    old?.close(1000, "Rotating token");
    attempt = 0;
    scheduleReconnect(true);
  };

  const startPolling = () => {
    if (!pollTimer) pollTimer = setInterval(() => opts.onResync(), pollMs);
  };
  const stopPolling = () => {
    clearInterval(pollTimer);
    pollTimer = undefined;
  };

  const scheduleReconnect = (immediate = false) => {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    // 1s, 2s, 4s ... capped at 30s, with jitter so a whole restaurant does not reconnect at once
    const delay = immediate ? 0 : Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
    attempt++;
    reconnectTimer = setTimeout(open, delay);
  };

  async function open() {
    if (stopped || !opts.url) return;
    setStatus("connecting");
    let token: string | null = null;
    try {
      token = await opts.getToken();
    } catch {
      token = null;
    }
    if (stopped) return;
    if (!token) {
      setStatus("offline");
      startPolling();
      scheduleReconnect();
      return;
    }

    const socket = new WebSocket(`${opts.url}/connect?token=${encodeURIComponent(token)}`);
    ws = socket;

    // Reconnect with a fresh token before this one expires, so service never drops
    clearTimeout(refreshTimer);
    const exp = tokenExpiry(token);
    if (exp) refreshTimer = setTimeout(() => ws === socket && rotate(), Math.max(1000, (exp * 1000 - Date.now()) * 0.8));

    socket.addEventListener("open", () => {
      attempt = 0;
      stopPolling();
      setStatus("live");
      // Anything that changed while we were away is picked up by reloading, not replaying
      if (connectedOnce) opts.onResync();
      connectedOnce = true;
      clearInterval(heartbeat);
      heartbeat = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), heartbeatMs);
    });

    socket.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      try {
        const frame = JSON.parse(String(e.data)) as { events?: RealtimeEvent[]; control?: string };
        if (frame.control === "token_expired") {
          if (ws === socket) rotate();
          return;
        }
        if (frame.events?.length) opts.onEvents(frame.events);
      } catch {
        // Ignore malformed frames; the next reload corrects the screen
      }
    });

    socket.addEventListener("close", (e) => {
      clearInterval(heartbeat);
      if (ws !== socket || stopped) return;
      ws = null;
      setStatus("offline");
      startPolling();
      scheduleReconnect(e.code === TOKEN_EXPIRED);
    });
  }

  const onVisible = () => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    opts.onResync();
    if (!ws || ws.readyState > WebSocket.OPEN) {
      attempt = 0;
      scheduleReconnect(true);
    }
  };

  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  if (opts.url) void open();
  else startPolling();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearTimeout(refreshTimer);
    clearInterval(heartbeat);
    stopPolling();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    ws?.close(1000, "Screen closed");
    ws = null;
  };
}
