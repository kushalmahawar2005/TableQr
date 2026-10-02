"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import { setupAction, setupOptionsAction } from "../actions";
import { kdsCopy } from "../_copy";
import { StationPicker } from "./kds-screen";

const field = "h-14 w-full rounded-lg border-2 border-kds-line bg-kds-bg px-4 text-[22px] text-kds-text outline-none focus:border-kds-text";

/** First run on a kitchen screen: a manager or owner signs in once and pins the station */
export function KdsSetup(props: { initialLang: Lang; preview?: { step?: "creds" | "station"; stations?: string[]; error?: string; outlet?: string; phone?: string } }) {
  const router = useRouter();
  const pv = props.preview;
  const [lang, setLang] = useState<Lang>(props.initialLang);
  const c = kdsCopy[lang];
  const [step, setStep] = useState<"creds" | "station">(pv?.step ?? "creds");
  const [outlet, setOutlet] = useState(pv?.outlet ?? "");
  const [phone, setPhone] = useState(pv?.phone ?? "");
  const [pin, setPin] = useState("");
  const [stations, setStations] = useState<string[]>(pv?.stations ?? []);
  const [station, setStation] = useState<string | null>(null);
  const [expeditor, setExpeditor] = useState(false);
  const [error, setError] = useState<string | null>(pv?.error ?? null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<{ ok: boolean; code?: string; reason?: string; message?: string }>, then: () => void) {
    if (pv) return;
    setBusy(true);
    setError(null);
    try {
      const res = await work();
      if (res.ok) then();
      else setError(c.errors[res.reason ?? ""] ?? c.errors[res.code ?? ""] ?? res.message ?? c.errors.failed);
    } catch {
      setError(c.offlineAction);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main lang={lang} className="flex min-h-dvh items-center justify-center bg-kds-bg p-6 font-sans text-kds-text">
      <section className="w-full max-w-[560px] rounded-xl bg-kds-card p-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-display text-[32px] font-bold leading-10">{c.setupTitle}</h1>
          <div className="flex shrink-0 gap-1">
            {(["en", "hi"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`h-11 rounded-lg px-3 text-[18px] font-semibold ${lang === l ? "bg-kds-text text-kds-bg" : "bg-kds-bg"}`}>
                {l === "en" ? "EN" : "हिन्दी"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[18px] text-kds-muted">{c.setupBody}</p>

        {step === "creds" ? (
          <form
            className="mt-6 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                async () => {
                  const res = await setupOptionsAction(outlet, phone, pin);
                  if (res.ok) setStations(res.data.stations);
                  return res;
                },
                () => setStep("station"),
              );
            }}
          >
            <label>
              <span className="text-[18px] text-kds-muted">{c.outlet}</span>
              <input className={`${field} uppercase`} value={outlet} onChange={(e) => setOutlet(e.target.value)} autoComplete="off" required />
            </label>
            <label>
              <span className="text-[18px] text-kds-muted">{c.phone}</span>
              <input className={field} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" required />
            </label>
            <label>
              <span className="text-[18px] text-kds-muted">{c.pin}</span>
              <input className={`${field} tracking-[0.5em]`} type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoComplete="off" required />
            </label>
            {error && <p role="alert" className="rounded-lg border-2 border-kds-late px-4 py-3 text-[18px] font-semibold">{error}</p>}
            <button type="submit" disabled={busy || pin.length !== 4} className="h-16 rounded-lg bg-kds-new text-[22px] font-bold disabled:opacity-50">
              {busy ? c.working : c.continue}
            </button>
          </form>
        ) : (
          <div className="mt-2">
            <StationPicker c={c} stations={stations} station={station} expeditor={expeditor} onPick={(st, ex) => (setStation(st), setExpeditor(ex))} />
            {error && <p role="alert" className="mt-4 rounded-lg border-2 border-kds-late px-4 py-3 text-[18px] font-semibold">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => (setStep("creds"), setPin(""))} className="h-16 rounded-lg bg-kds-bg px-6 text-[20px] font-semibold">
                {c.back}
              </button>
              <button
                type="button"
                disabled={busy || (!expeditor && !station)}
                onClick={() => run(() => setupAction(outlet, phone, pin, station, expeditor, lang), () => router.refresh())}
                className="h-16 flex-1 rounded-lg bg-kds-ok text-[22px] font-bold disabled:opacity-50"
              >
                {busy ? c.working : c.startScreen}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
