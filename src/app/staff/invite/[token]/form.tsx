"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { completeInvitationAction, sendInvitationCodeAction } from "./actions";

type Invitation = Awaited<ReturnType<typeof import("@/server/staff/invitations").getStaffInvitation>>;
const field = "h-12 w-full rounded-xl border border-line bg-background px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand";

export function StaffInviteForm({ token, invitation }: { token: string; invitation: Invitation }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [pin, setPin] = useState(""); const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; devCode?: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [complete, setComplete] = useState<{ name: string; phone: string; outletCode: string; role: string } | null>(null);

  if (!invitation.valid) return <main className="grid min-h-dvh place-items-center bg-background p-4"><section className="w-full max-w-md rounded-3xl border border-line bg-surface p-7 text-center"><h1 className="font-display text-title font-bold text-ink">Invitation unavailable</h1><p className="mt-2 text-sm text-muted">This invitation has expired, was revoked, or has already been used. Ask the restaurant owner for a new link.</p></section></main>;

  const role = invitation.role[0].toUpperCase() + invitation.role.slice(1);
  function requestCode() {
    setProblem("");
    start(async () => {
      const result = await sendInvitationCodeAction(token, phone);
      if (!result.ok) return setProblem(result.message);
      setChallenge({ id: result.data.challengeId, devCode: result.data.devCode });
    });
  }
  function finish() {
    setProblem("");
    start(async () => {
      if (!challenge) return;
      const result = await completeInvitationAction(token, { challengeId: challenge.id, code, name, pin });
      if (!result.ok) return setProblem(result.message);
      setComplete({ name: result.data.name, phone: result.data.phone, outletCode: result.data.outletCode, role: result.data.role });
    });
  }

  if (complete) return <main className="grid min-h-dvh place-items-center bg-background p-4"><section className="w-full max-w-md rounded-3xl border border-line bg-surface p-7"><CheckCircle2 className="size-10 text-success"/><h1 className="mt-3 font-display text-title font-bold text-ink">Staff access is ready</h1><p className="mt-2 text-sm text-muted">Welcome, {complete.name}. You can now sign in to {invitation.outletName} as {role}.</p><dl className="mt-5 space-y-2 rounded-2xl bg-ink/5 p-4 text-sm"><div className="flex justify-between gap-2"><dt className="text-muted">Outlet code</dt><dd className="font-mono font-semibold">{complete.outletCode}</dd></div><div className="flex justify-between gap-2"><dt className="text-muted">Phone</dt><dd className="font-mono font-semibold">{complete.phone}</dd></div><div className="flex justify-between gap-2"><dt className="text-muted">Sign in</dt><dd className="font-semibold">/console/login</dd></div></dl><p className="mt-3 text-xs text-muted">Use the PIN you just created, or your existing PIN if you already had a Tableeqr staff account.</p><button type="button" onClick={() => router.push("/console/login")} className="mt-5 h-12 w-full rounded-xl bg-brand font-semibold text-white">Go to sign in</button></section></main>;

  return <main className="grid min-h-dvh place-items-center bg-background p-4"><section className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-xl sm:p-8"><div className="grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand"><ShieldCheck className="size-6" aria-hidden="true"/></div><p className="mt-5 text-sm font-semibold text-muted">{invitation.outletName}</p><h1 className="mt-1 font-display text-title font-bold text-ink">Set up your staff access</h1><p className="mt-2 text-sm text-muted">You were invited as <b className="text-ink">{role}</b>. Verify the phone ending in <b className="font-mono text-ink">{invitation.phoneLast4}</b>, then add your name. If you already have Tableeqr staff access, your existing name and PIN stay.</p>
    <div className="mt-6 space-y-4"><label className="block space-y-1.5 text-sm font-semibold">Your name<input autoComplete="name" className={field} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"/></label><label className="block space-y-1.5 text-sm font-semibold">Invited mobile number<input autoComplete="tel-national" className={`${field} font-mono`} inputMode="numeric" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ""))} placeholder="10-digit mobile number"/></label>
      {!challenge ? <button type="button" disabled={busy || phone.replace(/\D/g, "").length < 10} onClick={requestCode} className="h-12 w-full rounded-xl bg-brand font-semibold text-white disabled:opacity-50">{busy ? "Sending code…" : "Send verification code"}</button> : <><label className="block space-y-1.5 text-sm font-semibold">4-digit code<input autoComplete="one-time-code" className={`${field} font-mono tracking-[0.4em]`} inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}/></label>{challenge.devCode && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Development test code: <b className="font-mono">{challenge.devCode}</b></p>}<label className="block space-y-1.5 text-sm font-semibold">Create a 4-digit PIN<input autoComplete="new-password" className={`${field} font-mono tracking-[0.4em]`} inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}/></label><button type="button" disabled={busy || code.length !== 4 || pin.length !== 4 || name.trim().length < 2} onClick={finish} className="h-12 w-full rounded-xl bg-brand font-semibold text-white disabled:opacity-50">{busy ? "Verifying…" : "Verify and activate access"}</button><button type="button" disabled={busy} onClick={requestCode} className="h-10 w-full text-sm font-semibold text-muted underline">Send a new code</button></>}
      {problem && <p role="alert" className="rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm font-semibold text-danger">{problem}</p>}</div>
  </section></main>;
}
