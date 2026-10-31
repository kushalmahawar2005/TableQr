"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, Users } from "lucide-react";
import { useGuestBase } from "@/lib/guest-base";
import { connectRealtime } from "@/lib/realtime-client";
import { useGuestExperience } from "../guest-shell";
import { GuestHeader } from "../_components/guest-ui";
import { joinWaitlistAction, leaveWaitlistAction, waitlistRealtimeTokenAction, waitlistStatusAction } from "./actions";

type WaitData = {
  position: number | null;
  partiesAhead: number;
  estimateMinutes: number;
  partySize: number;
  seatingPreference: string | null;
  status: string;
  joinedAt: number;
  updatedAt: number;
  readyDeadline: number | null;
  name: string;
  phone: string | null;
};
type Zone = { id: string; name: string };

const COPY = {
  en: {
    title: "Join the waitlist",
    titleJoined: "You’re in line",
    intro: "Tell us about your party and we’ll keep your place in line.",
    name: "Your name",
    phone: "Mobile number",
    guests: "Guests",
    seating: "Seating preference",
    any: "No preference",
    join: "Join the waitlist",
    joining: "Joining…",
    position: "Your place in line",
    ahead: (n: number) => `${n} ${n === 1 ? "party" : "parties"} ahead`,
    wait: "Estimated wait",
    minutes: "minutes",
    ready: "Your table is ready. Please come to the host within 10 minutes.",
    left: "You left the waitlist.",
    seated: "You’ve been seated.",
    expired: "This waitlist link has expired. Please ask the host for help.",
    leave: "Leave the waitlist",
    leaving: "Leaving…",
    error: "Could not connect. Please try again.",
  },
  hi: {
    title: "वेटिंग लिस्ट में शामिल हों",
    titleJoined: "आप लाइन में हैं",
    intro: "अपनी पार्टी की जानकारी दें। हम आपकी जगह का अपडेट देते रहेंगे।",
    name: "आपका नाम",
    phone: "मोबाइल नंबर",
    guests: "मेहमान",
    seating: "बैठने की पसंद",
    any: "कोई पसंद नहीं",
    join: "वेटिंग लिस्ट में जुड़ें",
    joining: "जोड़ रहे हैं…",
    position: "लाइन में आपकी जगह",
    ahead: (n: number) => `${n} पार्टी आपसे आगे`,
    wait: "अनुमानित इंतज़ार",
    minutes: "मिनट",
    ready: "आपकी टेबल तैयार है। कृपया 10 मिनट के भीतर होस्ट के पास आएँ।",
    left: "आप वेटिंग लिस्ट से बाहर आ गए हैं।",
    seated: "आपको टेबल मिल गई है।",
    expired: "यह वेटिंग लिस्ट लिंक समाप्त हो गया है। मदद के लिए होस्ट से बात करें।",
    leave: "वेटिंग लिस्ट छोड़ें",
    leaving: "बाहर कर रहे हैं…",
    error: "कनेक्ट नहीं हो पाया। कृपया फिर कोशिश करें।",
  },
} as const;

const fieldClass = "mt-1.5 min-h-12 w-full rounded-xl border border-line bg-paper px-3 text-body text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function WaitlistClient({
  outlet,
  zones,
  token: initialToken,
  realtimeUrl,
}: {
  outlet: string;
  zones: Zone[];
  token: string;
  realtimeUrl: string | null;
}) {
  const router = useRouter();
  const base = useGuestBase(outlet);
  const { brand, language } = useGuestExperience();
  const brandName = brand?.outlet.name ?? outlet;
  const hindi = language === "hi";
  const c = COPY[hindi ? "hi" : "en"];
  const [token, setToken] = useState(initialToken);
  const [data, setData] = useState<WaitData | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(2);
  const [preference, setPreference] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    let stop: (() => void) | undefined;
    const load = async () => {
      try {
        const result = await waitlistStatusAction(outlet, token);
        if (!active) return;
        if (result.ok) {
          setData(result.data);
          setMessage("");
        } else {
          setMessage(result.message);
        }
      } catch {
        if (active) setMessage(c.error);
      }
    };
    void load();
    const id = setInterval(() => void load(), 20000);
    void waitlistRealtimeTokenAction(outlet, token).then((result) => {
      if (!active || !result.ok || !result.token) return;
      stop = connectRealtime({
        url: realtimeUrl,
        getToken: async () => result.token,
        onEvents: () => void load(),
        onResync: () => void load(),
        pollMs: 20000,
      });
    });
    return () => {
      active = false;
      clearInterval(id);
      stop?.();
    };
  }, [outlet, token, realtimeUrl, c.error]);

  const join = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await joinWaitlistAction(outlet, {
        name,
        phone,
        partySize: party,
        seatingPreference: preference || "No preference",
      });
      if (result.ok) {
        setToken(result.data.token);
        router.replace(`${base}/waitlist?token=${encodeURIComponent(result.data.token)}`);
      } else {
        setMessage(result.message);
      }
    } catch {
      setMessage(c.error);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await leaveWaitlistAction(outlet, token);
      if (result.ok) {
        setMessage(result.data.status === "left" ? c.left : result.data.status);
        if (data) setData({ ...data, status: result.data.status });
      } else {
        setMessage(result.message);
      }
    } catch {
      setMessage(c.error);
    } finally {
      setBusy(false);
    }
  };

  const zoneName = zones.find((zone) => zone.id === data?.seatingPreference)?.name;
  const preferenceLabel = zoneName ?? data?.seatingPreference ?? c.any;
  const terminal = ["left", "skipped", "seated", "expired"].includes(data?.status ?? "");

  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--guest-nav-height))] w-full max-w-[520px] pb-8 text-ink">
      <GuestHeader outlet={outlet} title={hindi ? "वेटिंग लिस्ट" : "Waitlist"} />
      <section className="rounded-3xl bg-gradient-to-br from-brand-soft to-surface p-5 sm:p-6">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface text-brand shadow-sm" aria-hidden>
          {data ? <Clock3 size={24} /> : <Users size={24} />}
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[.16em] text-muted">{brandName}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">{data ? c.titleJoined : c.title}</h1>
        {!data && <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{c.intro}</p>}
      </section>

      {!data ? (
        <form
          className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <div className="grid gap-4">
            <label className="text-sm font-semibold">
              {c.name}
              <input required maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold">
              {c.phone}
              <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold">
              {c.guests}
              <input required type="number" min={1} max={12} value={party} onChange={(event) => setParty(Number(event.target.value))} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold">
              {c.seating}
              <select value={preference} onChange={(event) => setPreference(event.target.value)} className={fieldClass}>
                <option value="">{c.any}</option>
                {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy || !name.trim() || !phone.trim() || party < 1 || party > 12} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-brand-on shadow-sm disabled:opacity-50">
            {busy ? c.joining : c.join}<ArrowRight size={17} aria-hidden />
          </button>
        </form>
      ) : (
        <section className="mt-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6" aria-labelledby="wait-position">
          <p className="text-sm font-semibold text-muted">{c.position}</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <p id="wait-position" className="font-display text-6xl font-bold tabular-nums">{data.position ?? "—"}</p>
            <p className="pb-2 text-sm text-muted">{c.ahead(data.partiesAhead)}</p>
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-paper p-4">
            <Clock3 className="shrink-0 text-brand" size={22} aria-hidden />
            <p className="text-sm text-muted">{c.wait}<strong className="ml-1 text-ink">{data.estimateMinutes} {c.minutes}</strong></p>
          </div>
          <p className="mt-4 text-sm text-muted">{data.partySize} {c.guests.toLowerCase()} · {preferenceLabel}</p>
          {data.status === "notified" && <p role="status" className="mt-4 rounded-2xl bg-brand-soft p-4 text-sm font-semibold text-brand-strong">{c.ready}</p>}
          {terminal && <p role="status" className="mt-4 rounded-2xl bg-paper p-4 text-sm font-semibold">{data.status === "left" ? c.left : data.status === "seated" ? c.seated : c.expired}</p>}
          {!terminal && <button type="button" disabled={busy} onClick={() => void leave()} className="mt-5 min-h-12 w-full rounded-xl border border-line font-semibold hover:bg-paper disabled:opacity-50">{busy ? c.leaving : c.leave}</button>}
        </section>
      )}

      {message && <p role="status" className="mt-4 rounded-2xl border border-line bg-surface p-4 text-sm">{message}</p>}
    </main>
  );
}
