"use client";

import { AlertCircleIcon, Clock01Icon, InformationCircleIcon, MessageCancel01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { checkFirstName, MAX_NAME_LENGTH } from "@/domain/guest-name";
import { formatCountdown, isCompleteCode } from "@/domain/otp";
import { DEFAULT_COUNTRY, displayPhone, isValidIndianMobile, otpSupported, toE164 } from "@/domain/phone";
import type { Lang } from "@/lib/i18n";
import { PrimaryButton } from "../../_components/start-cta";
import { SlowNotice } from "../../_components/slow-notice";
import { g2Copy } from "../_copy";
import { sendCodeAction, verifyCodeAction } from "../actions";
import { NoticeCard } from "./notice-card";
import { OtpInput } from "./otp-input";
import { PhoneField } from "./phone-field";
import { TextField } from "./text-field";

type Challenge = { id: string; phone: string; expiresAt: number; resendAt: number; devCode?: string };
type Problem = "wrong" | "expired" | "sms_failed" | "rate_limited" | "network" | null;

type State = {
  name: string;
  country: string;
  phone: string;
  consent: boolean;
  step: "details" | "code";
  code: string;
  challenge: Challenge | null;
  /** Lockout end (this phone's clock, ms); the server is the one that enforces it */
  lockedUntil: number | null;
  problem: Problem;
  busy: "sending" | "verifying" | null;
  /** Counts wrong codes, replaying the single shake each time */
  shake: number;
  phoneTouched: boolean;
  nameRejected: boolean;
};

/** A frozen state for the dev review board; times are seconds from the board's "now" */
export type FormSnapshot = Partial<Pick<State, "name" | "country" | "phone" | "consent" | "step" | "code" | "problem" | "busy" | "phoneTouched">> & {
  expiresIn?: number;
  resendIn?: number;
  lockedFor?: number;
  focusCode?: boolean;
};

function initialState(p?: FormSnapshot): State {
  return {
    name: p?.name ?? "",
    country: p?.country ?? DEFAULT_COUNTRY,
    phone: p?.phone ?? "",
    consent: p?.consent ?? false,
    step: p?.step ?? "details",
    code: p?.code ?? "",
    challenge:
      p?.step === "code"
        ? { id: "preview", phone: toE164("+91", p.phone ?? ""), expiresAt: (p.expiresIn ?? 300) * 1000, resendAt: (p.resendIn ?? 0) * 1000 }
        : null,
    lockedUntil: p?.lockedFor ? p.lockedFor * 1000 : null,
    problem: p?.problem ?? null,
    busy: p?.busy ?? null,
    shake: 0,
    phoneTouched: p?.phoneTouched ?? false,
    nameRejected: false,
  };
}

/**
 * G2 form: name and mobile, then the 4-digit code. One primary button whose job follows the state
 * (Send code → Verify and continue → Send a new code), never submitted automatically.
 */
export function VerifyForm({
  outletCode,
  shortCode,
  outletName,
  lang,
  preview,
  returnToCart = false,
}: {
  outletCode: string;
  shortCode: string;
  outletName: string;
  lang: Lang;
  /** Dev review board: start in this state, never call the server, keep the clock still */
  preview?: FormSnapshot;
  returnToCart?: boolean;
}) {
  const c = g2Copy[lang];
  const router = useRouter();
  const tablePath = `/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}`;
  const [st, setSt] = useState<State>(() => initialState(preview));
  const set = (patch: Partial<State>) => setSt((s) => ({ ...s, ...patch }));
  const codeRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // Countdowns tick on this phone; the server checks every deadline again
  const [now, setNow] = useState(0);
  const ticking = !preview && (st.challenge !== null || st.lockedUntil !== null);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [ticking]);

  // The code boxes take focus when a code is sent
  const challengeId = st.challenge?.id;
  useEffect(() => {
    if (!preview && st.step === "code") codeRef.current?.focus();
  }, [preview, st.step, challengeId]);

  // A wrong code stays in the boxes, selected, so typing replaces it
  useEffect(() => {
    if (st.shake && !st.busy) {
      codeRef.current?.focus();
      codeRef.current?.select();
    }
  }, [st.shake, st.busy]);

  const secondsTo = (at: number) => Math.max(0, (at - now) / 1000);
  const locked = st.lockedUntil !== null && now < st.lockedUntil;
  const lockOver = st.lockedUntil !== null && !locked;
  const inCode = st.step === "code" && st.challenge !== null;
  const expired = inCode && !locked && (st.problem === "expired" || lockOver || now >= st.challenge!.expiresAt);
  const resendIn = st.challenge ? secondsTo(st.challenge.resendAt) : 0;

  const name = checkFirstName(st.name);
  const nameError = st.nameRejected || (!name.ok && name.reason !== "empty") ? c.nameError : undefined;
  const supported = otpSupported(st.country);
  const phoneValid = isValidIndianMobile(st.phone);
  const phoneError = supported && st.phone && !phoneValid && (st.phoneTouched || st.phone.length >= 10) ? c.phoneError : undefined;

  async function send() {
    if (preview) return;
    set({ busy: "sending", problem: null });
    let r: Awaited<ReturnType<typeof sendCodeAction>>;
    try {
      r = await sendCodeAction(outletCode, shortCode, { country: st.country, phone: st.phone });
    } catch {
      set({ busy: null, problem: "network" });
      return;
    }
    const t = Date.now();
    setNow(t);
    if (r.ok) {
      const res = r;
      setSt((s) => {
        const same = s.challenge?.id === res.challengeId;
        return {
          ...s,
          busy: null,
          step: "code",
          lockedUntil: null,
          code: same ? s.code : "",
          challenge: {
            id: res.challengeId,
            phone: res.phone,
            expiresAt: t + res.expiresIn * 1000,
            resendAt: t + res.resendIn * 1000,
            devCode: res.devCode ?? (same ? s.challenge?.devCode : undefined),
          },
        };
      });
      return;
    }
    switch (r.error) {
      case "table_changed":
        router.replace(tablePath);
        return;
      case "locked":
        set({ busy: null, lockedUntil: t + r.retryIn * 1000 });
        return;
      case "invalid_phone":
        set({ busy: null, phoneTouched: true });
        return;
      case "unsupported_country":
        set({ busy: null });
        return;
      case "failed":
        set({ busy: null, problem: "network" });
        return;
      default:
        set({ busy: null, problem: r.error });
    }
  }

  async function verify() {
    if (preview || !st.challenge) return;
    set({ busy: "verifying", problem: null });
    let r: Awaited<ReturnType<typeof verifyCodeAction>>;
    try {
      r = await verifyCodeAction(outletCode, shortCode, {
        challengeId: st.challenge.id,
        code: st.code,
        name: st.name,
        consent: st.consent,
      });
    } catch {
      set({ busy: null, problem: "network" });
      return;
    }
    // Straight to the menu: no success screen. The button stays busy while the menu loads.
    if (r.ok) return router.replace(returnToCart ? `${tablePath}/cart` : r.to);
    switch (r.error) {
      case "wrong":
        setSt((s) => ({ ...s, busy: null, problem: "wrong", shake: s.shake + 1 }));
        return;
      case "locked":
        set({ busy: null, code: "", lockedUntil: Date.now() + r.retryIn * 1000 });
        setNow(Date.now());
        return;
      case "expired":
        set({ busy: null, code: "", problem: "expired" });
        return;
      case "invalid_name":
        set({ busy: null, nameRejected: true });
        return;
      case "table_changed":
        router.replace(tablePath);
        return;
      case "failed":
        set({ busy: null, problem: "network" });
    }
  }

  function changeNumber() {
    set({ step: "details", code: "", problem: null });
    requestAnimationFrame(() => phoneRef.current?.focus());
  }

  // The one primary button
  let cta: { label: string; disabled?: boolean; run?: () => void; arrow?: boolean };
  if (st.busy) cta = { label: st.busy === "sending" ? c.sending : c.verifying };
  else if (locked) cta = { label: c.tryAgainIn(formatCountdown(secondsTo(st.lockedUntil!))), disabled: true };
  else if (st.step === "details")
    cta = { label: st.problem === "sms_failed" ? c.tryAgain : c.sendCode, disabled: !(name.ok && supported && phoneValid), run: send, arrow: true };
  else if (st.problem === "sms_failed") cta = { label: c.tryAgain, run: send, arrow: true };
  else if (expired) cta = { label: c.sendNew, run: send, arrow: true };
  else cta = { label: returnToCart ? c.verifyOrder : c.verify, disabled: !(isCompleteCode(st.code) && name.ok), run: verify, arrow: true };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!st.busy && !cta.disabled) cta.run?.();
  };

  const notice = locked ? (
    <NoticeCard icon={SquareLock02Icon} title={c.locked} />
  ) : st.problem === "sms_failed" ? (
    <NoticeCard icon={MessageCancel01Icon} title={c.smsFailed} body={c.askStaff} />
  ) : st.problem === "rate_limited" ? (
    <NoticeCard icon={AlertCircleIcon} title={c.rateLimited} body={c.rateLimitedBody} />
  ) : expired ? (
    <NoticeCard icon={Clock01Icon} title={c.expired} />
  ) : st.step === "details" && !supported ? (
    <NoticeCard icon={InformationCircleIcon} title={c.intlUnavailable} tone="neutral" />
  ) : null;

  const codeOff = locked || expired;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
      <div className="space-y-4">
        <TextField
          id="g2-name"
          label={c.nameLabel}
          help={c.nameHelp}
          error={nameError}
          value={st.name}
          onChange={(e) => set({ name: e.target.value, nameRejected: false })}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="given-name"
          autoCapitalize="words"
          enterKeyHint={st.step === "details" ? "next" : "done"}
        />

        {st.step === "details" || !st.challenge ? (
          <PhoneField
            ref={phoneRef}
            id="g2-phone"
            lang={lang}
            label={c.phoneLabel}
            countryLabel={c.countryLabel}
            country={st.country}
            digits={st.phone}
            onCountry={(country) => set({ country, problem: null })}
            onDigits={(phone) => set({ phone, phoneTouched: false, problem: st.problem === "sms_failed" ? "sms_failed" : null })}
            onBlur={() => set({ phoneTouched: true })}
            error={phoneError}
          />
        ) : (
          <div className="pt-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-caption text-muted">
                {c.codeSentTo} <span className="font-semibold tabular text-ink">{displayPhone(st.challenge.phone)}</span>
              </p>
              <button
                type="button"
                onClick={changeNumber}
                aria-label={c.changeNumber}
                className="-my-3 py-3 text-caption font-semibold text-brand-strong focus-visible:outline-2 focus-visible:outline-brand"
              >
                {c.change}
              </button>
            </div>

            <div className="mt-3">
              <OtpInput
                ref={codeRef}
                value={codeOff ? "" : st.code}
                onChange={(code) => set({ code, problem: st.problem === "wrong" ? null : st.problem })}
                label={c.codeLabel}
                disabled={codeOff}
                invalid={st.problem === "wrong"}
                shakeKey={st.shake}
                describedBy={st.problem === "wrong" ? "g2-code-error" : undefined}
                showFocus={preview?.focusCode}
              />
            </div>

            {st.problem === "wrong" && (
              <p id="g2-code-error" role="alert" className="mt-2 text-caption text-danger">
                {c.wrong}
              </p>
            )}
            {!codeOff && st.problem !== "sms_failed" && (
              <p className="mt-2 text-caption text-muted">
                {c.didntGet}{" "}
                {resendIn > 0 ? (
                  <span className="font-semibold tabular text-ink/80">{c.resendIn(formatCountdown(resendIn))}</span>
                ) : (
                  <button
                    type="button"
                    onClick={send}
                    disabled={!!st.busy}
                    className="-my-3 py-3 font-semibold text-brand-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {c.resend}
                  </button>
                )}
              </p>
            )}
            {st.challenge.devCode && !preview && !codeOff && (
              <p className="mt-2 inline-block rounded-md border border-dashed border-line px-2 py-0.5 text-label text-muted">
                Demo OTP · code <span className="tabular">{st.challenge.devCode}</span>
              </p>
            )}
          </div>
        )}

        {notice}

        {st.step === "code" && (
          <label className="flex cursor-pointer items-start gap-1">
            {/* 44px tap area around the 20px box */}
            <span className="-mt-3 -ml-3 grid size-11 shrink-0 place-items-center">
              <input
                type="checkbox"
                checked={st.consent}
                onChange={(e) => set({ consent: e.target.checked })}
                className="size-5 cursor-pointer accent-[var(--brand-main)]"
              />
            </span>
            <span className="text-body text-ink/85">
              {c.consent(outletName)} <span className="text-muted">{c.optional}</span>
            </span>
          </label>
        )}
      </div>

      {/* Right after the form, never fixed: large text pushes it down instead of covering fields */}
      <div className="pt-8 pb-[max(20px,env(safe-area-inset-bottom))]">
        <PrimaryButton label={cta.label} busy={!!st.busy} disabled={cta.disabled} arrow={cta.arrow && !st.busy} />
        {st.problem === "network" && (
          <p role="alert" className="mt-3 text-center text-caption text-danger">
            {c.network}
          </p>
        )}
        {st.busy && !preview && (
          <div className="mt-2">
            <SlowNotice text={c.slow} />
          </div>
        )}
      </div>
    </form>
  );
}
