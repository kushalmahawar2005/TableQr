"use client";
import {
  ArrowTurnBackwardIcon,
  Cancel01Icon,
  PackageRemoveIcon,
  Search01Icon,
  Settings02Icon,
  VolumeHighIcon,
  VolumeOffIcon,
  Wifi01Icon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/i18n";
import type { KdsBoard } from "@/server/kitchen/kds";
import { logoutAction, settingsAction, type KdsResult } from "../actions";
import { KdsActionsProvider, useKdsActions, wallActions, type KdsActions } from "./kds-actions";
import { kdsCopy, type KdsCopy } from "../_copy";
import { cookable, createAnnouncer, liveCard, sortCards, type Announcer, type Connection, type KdsCard } from "./kds-logic";
import { autoKotSaved, kotHtml, saveAutoKot } from "./kot-print";
import { printHtml } from "@/app/pos/_components/bill-print";
import { audioReady, playLate, playNewTicket, rememberedAnnouncements, saveAnnouncements, setSoundPref, soundPreference, subscribeSoundPref, unlockAudio } from "./sound";
import { TicketCard, type CardAction } from "./ticket-card";
import { useKdsSync } from "./use-kds-sync";

export type KdsDeviceView = {
  station: string | null;
  expeditor: boolean;
  lang: Lang;
  outletName: string;
  timezone: string;
};
type SearchHit = {
  id: string;
  nameEn: string;
  nameHi: string | null;
  station: string;
};

/** Fixed states for the /dev/s2 review board; never used on a real screen */
export type KdsPreview = {
  conn?: Connection;
  offline?: boolean;
  sound?: "on" | "off" | "locked";
  panel?: "stock" | "settings";
  stockQuery?: string;
  stockHits?: SearchHit[];
  toast?: string;
  busy?: Record<string, CardAction>;
  leaving?: string[];
  cards?: KdsCard[];
};

/**
 * The kitchen board. On a wall screen it acts through the screen's device cookie; inside the console
 * (`embedded`) it acts as the signed-in staff member and fits under the console's top bar.
 */
export function KdsScreen(props: { initial: KdsBoard; device: KdsDeviceView; realtimeUrl: string | null; preview?: KdsPreview; actions?: KdsActions; embedded?: boolean }) {
  return (
    <KdsActionsProvider value={props.actions ?? wallActions}>
      <KdsBoardScreen {...props} />
    </KdsActionsProvider>
  );
}

function KdsBoardScreen(props: { initial: KdsBoard; device: KdsDeviceView; realtimeUrl: string | null; preview?: KdsPreview; embedded?: boolean }) {
  const { device, preview } = props;
  const actions = useKdsActions();
  const lang = device.lang;
  const c = kdsCopy[lang];
  const router = useRouter();
  const sync = useKdsSync(props.initial, props.realtimeUrl, !!preview);
  const board = sync.board;
  const conn = preview?.conn ?? sync.conn;
  const offline = preview?.offline ?? sync.offline;

  const [busy, setBusy] = useState<Record<string, CardAction>>(preview?.busy ?? {});
  const [busyLines, setBusyLines] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set(preview?.leaving ?? []));
  const [panel, setPanel] = useState<"stock" | "settings" | null>(preview?.panel ?? null);
  const [toast, setToast] = useState<string | null>(preview?.toast ?? null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cards = useMemo(() => sortCards((preview?.cards ?? board.cards).map((card) => liveCard(card, sync.now))), [preview?.cards, board.cards, sync.now]);

  // Sound: the preference lives on this screen; playing needs one tap after each page load
  const soundPref = useSyncExternalStore(subscribeSoundPref, soundPreference, () => true);
  const [unlocked, setUnlocked] = useState(false);
  // Sound stays on across console pages and reloads: coming back finds it already running, and
  // after a reload the first tap anywhere turns it back on when the preference is on
  useEffect(() => {
    if (preview || !soundPref) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the audio context outlives this screen
    if (audioReady()) { setUnlocked(true); return; }
    const wake = () => void unlockAudio().then(setUnlocked);
    window.addEventListener("pointerdown", wake, { once: true });
    return () => window.removeEventListener("pointerdown", wake);
  }, [preview, soundPref]);
  const sound = preview?.sound ?? (!soundPref ? "off" : unlocked ? "on" : "locked");
  // Auto KOT: every new ticket prints a kitchen slip on this screen's printer
  const [autoKot, setAutoKot] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this device
  useEffect(() => { setAutoKot(autoKotSaved()); }, []);
  const announcer = useRef<Announcer | null>(null);
  const lastStation = useRef(board.station);

  useEffect(() => {
    if (preview) return;
    if (!announcer.current) announcer.current = createAnnouncer(rememberedAnnouncements());
    if (lastStation.current !== board.station) {
      lastStation.current = board.station;
      announcer.current.prime(cookable(cards));
      return;
    }
    const heard = announcer.current.next(cookable(cards));
    if (heard.arrived.length || heard.late.length) {
      saveAnnouncements(announcer.current.snapshot());
      if (autoKot && heard.arrived.length) {
        const fresh = cards.filter((x) => heard.arrived.includes(x.ticketId));
        if (fresh.length) printHtml(kotHtml(fresh));
      }
      if (sound === "on") {
        if (heard.late.length) playLate();
        else playNewTicket();
      }
    }
  }, [cards, board.station, preview, sound, autoKot]);

  function say(message: string) {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  function errorText(res: Extract<KdsResult<unknown>, { ok: false }>) {
    return c.errors[res.reason ?? ""] ?? c.errors[res.code] ?? (lang === "en" ? res.message : c.errors.failed);
  }

  async function guarded<T>(work: () => Promise<KdsResult<T>>): Promise<KdsResult<T> | null> {
    if (preview) return null;
    if (offline || !navigator.onLine) {
      say(c.offlineAction);
      return null;
    }
    try {
      const res = await work();
      if (!res.ok) {
        say(errorText(res));
        if (res.code === "staff_signed_out") router.refresh();
      }
      return res;
    } catch {
      say(c.offlineAction);
      return null;
    }
  }

  async function onAction(card: KdsCard, action: CardAction) {
    if (busy[card.ticketId]) return;
    setBusy((b) => ({ ...b, [card.ticketId]: action }));
    const fn = action === "accept" ? actions.accept : action === "start" ? actions.start : actions.bumpTicket;
    const res = await guarded(() => fn(card.ticketId));
    if (res?.ok && action === "bump") {
      // A calm exit: the card fades, then the board reloads without it
      setLeaving((l) => new Set(l).add(card.ticketId));
      say(c.bumped);
      setTimeout(() => void sync.refresh(), 450);
    } else await sync.refresh();
    setBusy((b) => {
      const next = { ...b };
      delete next[card.ticketId];
      return next;
    });
  }

  async function onBumpLine(card: KdsCard, lineId: string) {
    if (busyLines.has(lineId)) return;
    setBusyLines((s) => new Set(s).add(lineId));
    await guarded(() => actions.bumpLine(lineId));
    await sync.refresh();
    setBusyLines((s) => {
      const next = new Set(s);
      next.delete(lineId);
      return next;
    });
  }

  async function onRecall(ticketId: string) {
    const res = await guarded(() => actions.recall(ticketId));
    if (res?.ok) say(c.recalled);
    await sync.refresh();
  }

  const stations = device.expeditor ? [null, ...board.stations] : [device.station];

  return (
    <div lang={lang} className={`flex min-h-0 flex-col bg-kds-bg font-sans text-kds-text ${props.embedded ? "h-[calc(100dvh-7.5rem)] sm:h-[calc(100dvh-3.5rem)]" : "h-dvh"}`}>
      <Header
        c={c}
        lang={lang}
        device={device}
        board={board}
        now={sync.now}
        conn={conn}
        sound={sound}
        onSound={async () => {
          if (sound === "on") setSoundPref(false);
          else {
            setSoundPref(true);
            const on = await unlockAudio();
            setUnlocked(on);
            // One ring straight away, so the kitchen knows the volume is right
            if (on) playNewTicket();
          }
        }}
        onSettings={props.embedded ? undefined : () => setPanel("settings")}
        autoKot={autoKot}
        onAutoKot={() => { saveAutoKot(!autoKot); setAutoKot(!autoKot); }}
      />

      {device.expeditor && (
        <nav aria-label={c.station} className="flex shrink-0 gap-2 overflow-x-auto border-b border-kds-line px-4 py-2">
          {stations.map((st) => {
            const active = board.station === st;
            const label = st ?? c.allTab;
            const count = board.counts[st ?? "All"] ?? 0;
            return device.expeditor ? (
              <button
                key={label}
                type="button"
                onClick={() => !preview && sync.showStation(st)}
                aria-pressed={active}
                className={`flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-lg px-4 text-[20px] font-semibold ${active ? "bg-kds-text text-kds-bg" : "bg-kds-card text-kds-text"}`}
              >
                {label}
                <span className={`tabular rounded-md px-2 text-[18px] ${active ? "bg-kds-bg text-kds-text" : "bg-kds-line"}`}>{count}</span>
              </button>
            ) : (
              <span key={label} className="flex h-12 items-center gap-2 rounded-lg bg-kds-text px-4 text-[20px] font-semibold text-kds-bg">
                {label}
                <span className="tabular rounded-md bg-kds-bg px-2 text-[18px] text-kds-text">{count}</span>
              </span>
            );
          })}
        </nav>
      )}

      {offline && (
        <div role="status" className="flex shrink-0 items-center gap-3 bg-kds-late px-4 py-2.5 text-[20px] font-bold">
          <HugeiconsIcon icon={WifiOff01Icon} size={24} aria-hidden />
          {c.offlineBar}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-10">
        {cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="font-display text-[34px] font-bold">{c.emptyTitle}</p>
            <p className="mt-2 max-w-xl text-[20px] text-kds-muted">{c.emptyBody}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] items-start gap-4">
            {cards.map((card) => (
              <TicketCard
                key={card.ticketId}
                card={card}
                lang={lang}
                c={c}
                showStation={device.expeditor}
                canAct={!offline && (device.expeditor || card.station === device.station)}
                busy={busy[card.ticketId] ?? null}
                busyLines={busyLines}
                leaving={leaving.has(card.ticketId)}
                onAction={onAction}
                onBumpLine={onBumpLine}
                onPrint={() => printHtml(kotHtml([card]))}
              />
            ))}
          </div>
        )}
      </main>

      <BottomBar c={c} board={board} now={sync.now} offline={offline} onRecall={onRecall} onStock={() => setPanel("stock")} />

      {toast && (
        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
          <p className="rounded-lg bg-kds-text px-5 py-3 text-[20px] font-semibold text-kds-bg">{toast}</p>
        </div>
      )}

      {panel === "stock" && (
        <StockPanel c={c} lang={lang} board={board} offline={offline} preview={preview} onClose={() => setPanel(null)} say={say} guarded={guarded} refresh={sync.refresh} />
      )}
      {panel === "settings" && <SettingsPanel c={c} device={device} stations={board.stations} preview={!!preview} soundPref={soundPref} onClose={() => setPanel(null)} />}
    </div>
  );
}

function Header(props: {
  c: KdsCopy;
  lang: Lang;
  device: KdsDeviceView;
  board: KdsBoard;
  now: number;
  conn: Connection;
  sound: "on" | "off" | "locked";
  onSound: () => void;
  autoKot: boolean;
  onAutoKot: () => void;
  /** Missing inside the console: there is no wall-screen device to set up there */
  onSettings?: () => void;
}) {
  const { c, lang, device, board, now, conn, sound } = props;
  const time = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN-u-nu-latn" : "en-IN", { hour: "numeric", minute: "2-digit", timeZone: device.timezone }).format(now);
  const connLabel = {
    live: c.live,
    connecting: c.connecting,
    reconnecting: c.reconnecting,
    polling: c.polling,
    offline: c.offlinePill,
  }[conn];
  const connTone = conn === "live" ? "text-kds-text" : conn === "offline" ? "text-kds-late" : conn === "polling" ? "text-kds-muted" : "text-kds-amber";
  return (
    <header className="flex min-h-[72px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-kds-line px-4 py-2 sm:h-[72px] sm:flex-nowrap sm:gap-x-6 sm:py-0">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-bold leading-8 sm:text-[28px]">
          {c.kitchen} <span className="text-kds-muted">·</span> {board.station ?? (device.expeditor ? c.all : device.station)}
          {!device.expeditor && <span className="tabular ml-3 rounded-md bg-kds-text px-2 align-middle text-[22px] text-kds-bg">{board.counts[device.station ?? ""] ?? 0}</span>}
        </h1>
        <p className="truncate text-[16px] leading-6 text-kds-muted">
          {device.outletName}
          {device.expeditor ? ` · ${c.expeditor}` : ""}
        </p>
      </div>
      <p className="tabular ml-auto font-display text-[26px] font-bold sm:text-[30px]" aria-label={c.clock}>
        {time}
      </p>
      {board.avgMinutes !== null && <p className="hidden text-[18px] text-kds-muted xl:block">{c.avg(board.avgMinutes)}</p>}
      <button
        type="button"
        onClick={props.onSound}
        aria-label={sound === "locked" ? c.enableSound : sound === "on" ? c.soundOn : c.soundOff}
        className={`flex h-11 items-center gap-2 rounded-lg px-3 text-[18px] font-semibold sm:h-12 sm:px-4 ${sound === "locked" ? "bg-kds-new" : "bg-kds-card"}`}
      >
        <HugeiconsIcon icon={sound === "off" ? VolumeOffIcon : VolumeHighIcon} size={22} aria-hidden />
        <span className={sound === "locked" ? "text-[16px] sm:text-[18px]" : "hidden sm:inline"}>{sound === "locked" ? c.enableSound : sound === "on" ? c.soundOn : c.soundOff}</span>
      </button>
      <button type="button" onClick={props.onAutoKot} aria-pressed={props.autoKot} className={`flex h-11 items-center gap-2 rounded-lg px-3 text-[18px] font-semibold sm:h-12 sm:px-4 ${props.autoKot ? "bg-kds-ok text-kds-bg" : "bg-kds-card"}`}>
        {props.autoKot ? c.autoKotOn : c.autoKotOff}
      </button>
      <span role="status" aria-label={connLabel} className={`flex items-center gap-2 text-[18px] font-semibold ${connTone}`}>
        <HugeiconsIcon icon={conn === "offline" ? WifiOff01Icon : Wifi01Icon} size={22} aria-hidden />
        <span className="hidden sm:inline">{connLabel}</span>
      </span>
      {props.onSettings && (
        <button type="button" onClick={props.onSettings} aria-label={c.settings} className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg bg-kds-card sm:ml-0 sm:h-12 sm:w-12">
          <HugeiconsIcon icon={Settings02Icon} size={24} aria-hidden />
        </button>
      )}
    </header>
  );
}

function BottomBar({
  c,
  board,
  now,
  offline,
  onRecall,
  onStock,
}: {
  c: KdsCopy;
  board: KdsBoard;
  now: number;
  offline: boolean;
  onRecall: (id: string) => void;
  onStock: () => void;
}) {
  const last = board.lastBumped;
  const left = last ? Math.max(0, last.recallUntil - now) : 0;
  const blocked = last ? (last.blocked ?? (left <= 0 ? "expired" : null)) : null;
  return (
    <footer className="flex min-h-20 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-kds-line px-4 py-2 sm:h-20 sm:flex-nowrap sm:py-0">
      {last ? (
        <>
          <p className="min-w-0 truncate text-[20px]">
            <span className="text-kds-muted">{c.lastBump}: </span>
            <span className="font-semibold">
              {last.tableCode} · {c.round(last.roundNo)} · {last.station}
            </span>
          </p>
          <button
            type="button"
            disabled={!!blocked || offline}
            onClick={() => onRecall(last.ticketId)}
            className="flex h-14 shrink-0 items-center gap-2 rounded-lg border-2 border-kds-text px-5 text-[20px] font-bold disabled:border-kds-line disabled:text-kds-muted"
          >
            <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={22} aria-hidden />
            {blocked === "expired"
              ? c.recallExpired
              : blocked === "served"
                ? c.recallServed
                : `${c.recall} · ${c.recallLeft(Math.floor(left / 60_000), Math.floor((left % 60_000) / 1000))}`}
          </button>
        </>
      ) : (
        <p className="text-[20px] text-kds-muted">{c.nothingBumped}</p>
      )}
      <button type="button" onClick={onStock} className="ml-auto flex h-14 shrink-0 items-center gap-2 rounded-lg bg-kds-card px-5 text-[20px] font-bold">
        <HugeiconsIcon icon={PackageRemoveIcon} size={22} aria-hidden />
        {c.stock}
        {board.unavailable.length > 0 && <span className="tabular rounded-md bg-kds-late px-2 text-[18px]">{board.unavailable.length}</span>}
      </button>
    </footer>
  );
}

function Drawer({ title, onClose, c, children }: { title: string; onClose: () => void; c: KdsCopy; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-kds-bg/70" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-[520px] flex-col border-l border-kds-line bg-kds-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-kds-line px-5">
          <h2 className="font-display text-[22px] font-bold sm:text-[26px]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={c.close} className="flex h-12 w-12 items-center justify-center rounded-lg bg-kds-bg">
            <HugeiconsIcon icon={Cancel01Icon} size={24} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </section>
    </div>
  );
}

function StockPanel(props: {
  c: KdsCopy;
  lang: Lang;
  board: KdsBoard;
  offline: boolean;
  preview?: KdsPreview;
  onClose: () => void;
  say: (m: string) => void;
  guarded: <T>(work: () => Promise<KdsResult<T>>) => Promise<KdsResult<T> | null>;
  refresh: () => Promise<void>;
}) {
  const { c, lang, board, offline, preview } = props;
  const actions = useKdsActions();
  const [q, setQ] = useState(preview?.stockQuery ?? "");
  const [hits, setHits] = useState<SearchHit[]>(preview?.stockHits ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const name = (en: string, hi: string | null) => (lang === "hi" && hi ? hi : en);
  const out = new Set(board.unavailable.map((u) => u.id));

  function onQuery(value: string) {
    setQ(value);
    clearTimeout(timer.current);
    if (preview) return;
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const res = await actions.search(value).catch(() => null);
      if (res?.ok) setHits(res.data);
    }, 250);
  }

  async function toggle(id: string, label: string, outOfStock: boolean) {
    setBusy(id);
    const res = await props.guarded(() => actions.stock(id, outOfStock));
    if (res?.ok) props.say(outOfStock ? c.stockDone(label) : c.stockRestored(label));
    await props.refresh();
    setBusy(null);
  }

  return (
    <Drawer title={c.stockTitle} onClose={props.onClose} c={c}>
      <label className="flex h-14 items-center gap-3 rounded-lg border-2 border-kds-line bg-kds-bg px-4">
        <HugeiconsIcon icon={Search01Icon} size={22} className="text-kds-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={c.stockSearch}
          aria-label={c.stockSearch}
          className="h-full flex-1 bg-transparent text-[20px] text-kds-text outline-none placeholder:text-kds-muted"
        />
      </label>
      <p className="mt-2 text-[16px] text-kds-muted">{q.trim().length < 2 ? c.stockHint : hits.length === 0 ? c.stockNone : c.placedUntouched}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {hits.map((h) => (
          <li key={h.id} className="flex items-center gap-3 rounded-lg bg-kds-bg px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[20px] font-semibold">{name(h.nameEn, h.nameHi)}</p>
              <p className="text-[16px] text-kds-muted">{h.station}</p>
            </div>
            {out.has(h.id) ? (
              <span className="text-[18px] font-semibold text-kds-late">{c.stockNow}</span>
            ) : (
              <button
                type="button"
                disabled={offline || busy === h.id}
                onClick={() => toggle(h.id, name(h.nameEn, h.nameHi), true)}
                className="h-12 shrink-0 rounded-lg bg-kds-late px-4 text-[18px] font-bold disabled:opacity-50"
              >
                {busy === h.id ? c.working : c.markOut}
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-[20px] font-bold">{c.stockNow}</h3>
      {board.unavailable.length === 0 ? (
        <p className="mt-2 text-[18px] text-kds-muted">{c.stockEmpty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {board.unavailable.map((u) => (
            <li key={u.id} className="flex items-center gap-3 rounded-lg border-2 border-kds-late px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[20px] font-semibold">{name(u.nameEn, u.nameHi)}</p>
                <p className="text-[16px] text-kds-muted">
                  {u.station}
                  {u.until ? ` · ${c.backTomorrow}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={offline || busy === u.id}
                onClick={() => toggle(u.id, name(u.nameEn, u.nameHi), false)}
                className="h-12 shrink-0 rounded-lg bg-kds-ok px-4 text-[18px] font-bold disabled:opacity-50"
              >
                {busy === u.id ? c.working : c.restore}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

const field = "mt-1 h-14 w-full rounded-lg border-2 border-kds-line bg-kds-bg px-4 text-[20px] text-kds-text outline-none focus:border-kds-text";

function SettingsPanel(props: { c: KdsCopy; device: KdsDeviceView; stations: string[]; preview: boolean; soundPref: boolean; onClose: () => void }) {
  const { c, device, stations } = props;
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [expeditor, setExpeditor] = useState(device.expeditor);
  const [station, setStation] = useState<string | null>(device.station);
  const [lang, setLang] = useState<Lang>(device.lang);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(kind: "save" | "logout") {
    if (props.preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = kind === "save" ? await settingsAction(phone, pin, station, expeditor, lang) : await logoutAction(phone, pin);
      if (res.ok) {
        props.onClose();
        router.refresh();
      } else setError(c.errors[res.reason ?? ""] ?? c.errors[res.code] ?? res.message);
    } catch {
      setError(c.offlineAction);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={c.settingsTitle} onClose={props.onClose} c={c}>
      <p className="text-[18px] text-kds-muted">{c.settingsBody}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        <label className="block">
          <span className="text-[16px] font-semibold text-kds-muted">{c.phone}</span>
          <input className={field} inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[16px] font-semibold text-kds-muted">{c.pin}</span>
          <input
            className={`${field} tracking-[0.4em]`}
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </label>
      </div>

      <StationPicker c={c} stations={stations} station={station} expeditor={expeditor} onPick={(st, ex) => (setStation(st), setExpeditor(ex))} />

      <p className="mt-5 text-[18px] font-semibold">{c.language}</p>
      <div className="mt-2 flex gap-2">
        {(["en", "hi"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`h-12 flex-1 rounded-lg border-2 text-[20px] font-semibold ${lang === l ? "border-kds-text bg-kds-text text-kds-bg" : "border-kds-line bg-kds-bg"}`}
          >
            {l === "en" ? "English" : "हिन्दी"}
          </button>
        ))}
      </div>

      <label className="mt-5 flex h-14 items-center justify-between rounded-lg bg-kds-bg px-4 text-[18px]">
        {c.soundPref}
        <input type="checkbox" className="h-6 w-6 accent-kds-ok" checked={props.soundPref} onChange={(e) => setSoundPref(e.target.checked)} />
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border-2 border-kds-late px-4 py-3 text-[18px] font-semibold">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || pin.length !== 4}
        onClick={() => submit("save")}
        className="mt-3 h-16 w-full rounded-lg bg-kds-ok text-[22px] font-bold disabled:opacity-40"
      >
        {busy ? c.working : c.save}
      </button>
      <button
        type="button"
        disabled={busy || pin.length !== 4}
        onClick={() => submit("logout")}
        className="mt-3 h-14 w-full rounded-lg border-2 border-kds-late text-[20px] font-bold text-kds-text disabled:opacity-50"
      >
        {c.logout}
      </button>
      <p className="mt-1 text-center text-[16px] text-kds-muted">{c.logoutBody}</p>
    </Drawer>
  );
}

export function StationPicker(props: { c: KdsCopy; stations: string[]; station: string | null; expeditor: boolean; onPick: (station: string | null, expeditor: boolean) => void }) {
  const { c, stations, station, expeditor } = props;
  return (
    <fieldset className="mt-5">
      <legend className="text-[18px] font-semibold">{c.chooseStation}</legend>
      {stations.length === 0 && <p className="mt-2 text-[18px] text-kds-muted">{c.noStations}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {stations.map((st) => (
          <button
            key={st}
            type="button"
            aria-pressed={!expeditor && station === st}
            onClick={() => props.onPick(st, false)}
            className={`flex h-14 items-center justify-center gap-2 rounded-lg border-2 text-[20px] font-semibold ${!expeditor && station === st ? "border-kds-text bg-kds-text text-kds-bg" : "border-kds-line bg-kds-bg"}`}
          >
            {!expeditor && station === st && <span aria-hidden>✓</span>}
            {st}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={expeditor}
        onClick={() => props.onPick(null, true)}
        className={`mt-2 w-full rounded-lg border-2 px-4 py-3 text-left ${expeditor ? "border-kds-text bg-kds-text text-kds-bg" : "border-kds-line bg-kds-bg"}`}
      >
        <span className="block text-[20px] font-semibold">{expeditor && <span aria-hidden>✓ </span>}{c.expeditorAll}</span>
        <span className={`block text-[16px] ${expeditor ? "text-kds-bg/80" : "text-kds-muted"}`}>{c.expeditorBody}</span>
      </button>
    </fieldset>
  );
}
