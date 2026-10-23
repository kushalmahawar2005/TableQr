"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { openCheckout } from "@/lib/payments/checkout";
import { bookingPreorderMenuAction, bookingSummaryAction, claimBookingAdvanceAction, confirmBookingAction, saveBookingPreorderAction, sendBookingOtpAction, startBookingCreditAction, verifyBookingOtpAction } from "../actions";

const money = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
type Summary = Extract<Awaited<ReturnType<typeof bookingSummaryAction>>, { ok: true }>["data"];
type MenuItem = { id: string; nameEn: string; nameHi: string | null; pricePaise: number; taxRateBp: number; groups: { minSelect: number }[] };

function inclusiveTotal(lines: { qty: number; unitPricePaise: number; taxRateBp: number }[]) {
  const taxByRate = new Map<number, number>();
  let subtotal = 0;
  for (const line of lines) {
    subtotal += line.qty * line.unitPricePaise;
    taxByRate.set(line.taxRateBp, (taxByRate.get(line.taxRateBp) ?? 0) + line.qty * line.unitPricePaise * line.taxRateBp / 10_000);
  }
  return subtotal + [...taxByRate.values()].reduce((sum, tax) => sum + Math.floor(tax + 0.5), 0);
}

function ManualAdvance({ summary, outletCode, token, disabled, onRefresh }: { summary: Summary; outletCode: string; token: string; disabled: boolean; onRefresh: () => Promise<void> }) {
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  if (summary.manualClaimedAt) return <div className="mt-3"><p className="font-semibold">Reference submitted: {summary.manualReference}</p><p className="mt-2">The restaurant is checking receipt. Your booking is confirmed only after staff verify payment. Please do not pay again.</p><p className="mt-2">{summary.holdExpiresAt && summary.holdExpiresAt > clock ? `Table held until ${new Date(summary.holdExpiresAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.` : "The hold has expired. Please contact the restaurant to arrange your booking or refund."}</p><button type="button" onClick={() => void onRefresh()} className="mt-3 min-h-11 rounded-xl border border-line px-4 font-semibold">Check status</button>{summary.status === "requested" && summary.holdExpiresAt && summary.holdExpiresAt > clock && <details className="mt-3"><summary className="cursor-pointer font-semibold">Correct transaction reference</summary><input aria-label="Correct transaction reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={40} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3" /><button type="button" disabled={busy || reference.trim().length < 6} onClick={async () => { setBusy(true); setError(""); try { const result = await claimBookingAdvanceAction(outletCode, token, reference); if (result.ok) await onRefresh(); else setError(result.message); } catch { setError("Could not update the reference. Try again."); } finally { setBusy(false); } }} className="mt-2 min-h-11 rounded-xl border border-line px-4 font-semibold">Update reference</button>{error && <p role="alert" className="mt-2 text-danger">{error}</p>}</details>}</div>;
  if (!summary.verified) return <p className="mt-3 font-semibold">Verify your mobile number below before paying using the restaurant’s QR.</p>;
  if (summary.status !== "requested" || !summary.holdExpiresAt || summary.holdExpiresAt <= clock) return <p className="mt-3 font-semibold">Your table hold has expired. Contact the restaurant before making a payment.</p>;
  return <div className="mt-3">
    <p>Pay <strong>{money(summary.creditRequiredPaise - summary.creditPaidPaise)}</strong> directly to the restaurant. Check the payee name in your payment app before paying.</p>
    {summary.paymentQrUrl && <Image src={summary.paymentQrUrl} alt="Restaurant UPI payment QR" width={280} height={280} unoptimized className="mx-auto mt-3 max-h-80 w-full max-w-72 rounded-xl bg-white object-contain p-3" />}
    <p className="mt-2 text-xs">Use another phone to scan, or save the image and use your payment app’s scan-from-gallery option.</p>
    <label className="mt-3 block font-semibold">Transaction reference (UTR)<input value={reference} onChange={event => setReference(event.target.value)} maxLength={40} autoComplete="off" className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3" /></label>
    <button type="button" disabled={disabled || busy || reference.trim().length < 6} onClick={async () => {
      setBusy(true); setError("");
      try { const result = await claimBookingAdvanceAction(outletCode, token, reference); if (!result.ok) { setError(result.message); return; } await onRefresh(); }
      catch { setError("Could not submit the reference. Try again; do not pay a second time."); }
      finally { setBusy(false); }
    }} className="mt-3 min-h-11 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on disabled:opacity-50">{busy ? "Submitting…" : "I have paid · submit reference"}</button>
    {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
  </div>;
}

export function DetailsClient({ outletCode, token }: { outletCode: string; token: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null); const [menu, setMenu] = useState<MenuItem[]>([]); const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [challenge, setChallenge] = useState(""); const [code, setCode] = useState(""); const [marketing, setMarketing] = useState(false); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [devCode, setDevCode] = useState(""); const [preorderSaved, setPreorderSaved] = useState(false);
  const refresh = async () => { const r = await bookingSummaryAction(outletCode, token); if (r.ok) { setSummary(r.data); setName(r.data.name === "Pending guest" ? "" : r.data.name); setPhone(r.data.phone ?? ""); setQty(Object.fromEntries(r.data.preorder.map(line => [line.itemId, line.qty]))); setPreorderSaved(true); } else setMessage(r.message); };
  useEffect(() => {
    if (!token) return;
    let active = true;
    void bookingSummaryAction(outletCode, token).then(r => { if (!active) return; if (r.ok) { setSummary(r.data); setName(r.data.name === "Pending guest" ? "" : r.data.name); setPhone(r.data.phone ?? ""); setQty(Object.fromEntries(r.data.preorder.map(line => [line.itemId, line.qty]))); setPreorderSaved(true); } else setMessage(r.message); });
    void bookingPreorderMenuAction(outletCode).then(r => { if (active && r.ok) setMenu(r.data); });
    return () => { active = false; };
  }, [outletCode, token]);
  useEffect(() => {
    if (summary?.status === "confirmed") router.replace(`/r/${encodeURIComponent(outletCode)}/book/confirmed?token=${encodeURIComponent(token)}`);
  }, [summary?.status, outletCode, token, router]);
  useEffect(() => {
    if (!summary?.manualClaimedAt || summary.manualConfirmedAt) return;
    let active = true;
    let loading = false;
    const update = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try { const result = await bookingSummaryAction(outletCode, token); if (active && result.ok) setSummary(result.data); }
      catch { if (active) setMessage("Could not refresh payment status. Check your connection and try again; do not pay again."); }
      finally { loading = false; }
    };
    const timer = window.setInterval(() => void update(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [summary?.manualClaimedAt, summary?.manualConfirmedAt, outletCode, token]);
  const savePreorder = async () => { setBusy(true); const lines = Object.entries(qty).filter(([, count]) => count > 0).map(([itemId, count]) => ({ itemId, qty: count })); const r = await saveBookingPreorderAction(outletCode, token, lines); setBusy(false); if (!r.ok) { setMessage(r.message); return; } setPreorderSaved(true); await refresh(); setMessage(lines.length ? "Your preorder is saved. Pay the advance before confirming." : "Preorder removed."); };
  const send = async () => { setBusy(true); const r = await sendBookingOtpAction(outletCode, token, phone); setBusy(false); if (r.ok) { setChallenge(r.data.challengeId); setDevCode(r.data.devCode ?? ""); setMessage("Code sent."); } else setMessage(r.message); };
  const confirm = async () => { setBusy(true); try { const result = await confirmBookingAction(outletCode, token, { name, phone }); if (result.ok) router.push(`/r/${encodeURIComponent(outletCode)}/book/confirmed?token=${encodeURIComponent(token)}`); else setMessage(result.message); } finally { setBusy(false); } };
  const verify = async () => { setBusy(true); const r = await verifyBookingOtpAction(outletCode, token, { challengeId: challenge, code, name, marketingConsent: marketing }); if (!r.ok) { setBusy(false); setMessage(r.message); return; } await refresh(); setBusy(false); if (summary && summary.creditRequiredPaise > summary.creditPaidPaise) { setMessage("Mobile number verified. Complete your advance payment to continue."); return; } await confirm(); };
  const payCredit = async () => { setBusy(true); const r = await startBookingCreditAction(outletCode, token, globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`, window.location.origin); setBusy(false); if (r.ok && !r.data.paid) { try { await openCheckout(r.data.checkout); } catch { setMessage("Payment page could not open. Try again."); } } else if (!r.ok) setMessage(r.message); else await refresh(); };
  const draftTotal = inclusiveTotal(menu.filter(item => (qty[item.id] ?? 0) > 0).map(item => ({ qty: qty[item.id], unitPricePaise: item.pricePaise, taxRateBp: item.taxRateBp })));
  if (!summary) return <main className="mx-auto min-h-dvh max-w-[520px] px-5 py-8"><h1 className="font-display text-3xl font-bold">Booking details</h1><p className="mt-4 text-muted">{message || "Loading your hold…"}</p></main>;
  return <main className="mx-auto min-h-dvh max-w-[520px] px-5 py-8 text-ink">
    <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted">{summary.manualClaimedAt ? "Payment verification" : "Five-minute hold"}</p><h1 className="mt-2 font-display text-3xl font-bold">Complete your booking</h1>
    {summary.manualConfirmedAt && summary.status !== "confirmed" && <p role="status" className="mt-4 rounded-xl bg-brand-soft p-4 text-sm font-semibold">Your advance was received after the hold expired. Please contact the restaurant to arrange a new booking or refund.</p>}
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4"><p className="text-sm text-muted">Booking reference</p><p className="text-xl font-bold">{summary.reference}</p><p className="mt-3 text-sm">{new Date(summary.startAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {summary.partySize} guests</p></section>
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><h2 className="font-semibold">Preorder food (optional)</h2><p className="mt-1 text-sm text-muted">We’ll prepare it after you arrive and staff seats your party. The preorder amount is paid in advance and credited to your final bill.</p><div className="mt-3 grid gap-2">{menu.filter(item => item.groups.every(group => group.minSelect === 0)).map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"><div><p className="font-medium">{item.nameEn}</p><p className="text-sm text-muted">{money(item.pricePaise)}</p></div><div className="flex items-center gap-3"><button type="button" aria-label={`Remove ${item.nameEn}`} disabled={busy || !!summary.manualClaimedAt || !(qty[item.id] ?? 0)} onClick={() => { setQty(v => ({ ...v, [item.id]: Math.max(0, (v[item.id] ?? 0) - 1) })); setPreorderSaved(false); }} className="size-9 rounded-full border border-line">−</button><span className="w-4 text-center">{qty[item.id] ?? 0}</span><button type="button" aria-label={`Add ${item.nameEn}`} disabled={busy || !!summary.manualClaimedAt || (qty[item.id] ?? 0) >= 20} onClick={() => { setQty(v => ({ ...v, [item.id]: (v[item.id] ?? 0) + 1 })); setPreorderSaved(false); }} className="size-9 rounded-full border border-line">+</button></div></div>)}</div>{summary.preorder.length > 0 && <div className="mt-3 rounded-xl bg-paper p-3 text-sm"><p className="font-semibold">Saved preorder</p>{summary.preorder.map(line => <p key={line.itemId} className="mt-1">{line.qty} × {line.nameEn} · {money(line.qty * line.unitPricePaise)}</p>)}</div>}<div className="mt-3 flex items-center justify-between"><span className="text-sm text-muted">Draft preorder</span><strong>{money(draftTotal)}</strong></div><button type="button" disabled={busy || preorderSaved} onClick={() => void savePreorder()} className="mt-3 min-h-11 w-full rounded-xl border border-line px-4 font-semibold disabled:opacity-50">{preorderSaved ? "Preorder saved" : "Save preorder"}</button></section>
    {summary.creditRequiredPaise > 0 && <section className="mt-4 rounded-2xl bg-brand-soft p-4 text-sm"><p>Advance due: <strong>{money(summary.creditRequiredPaise)}</strong>{summary.creditPaidPaise > 0 ? ` · Received ${money(summary.creditPaidPaise)}` : ""}. This amount will be credited to your final bill.</p>{summary.creditPaidPaise < summary.creditRequiredPaise && (summary.paymentMode === "manual_qr" ? <ManualAdvance summary={summary} outletCode={outletCode} token={token} disabled={busy || !preorderSaved} onRefresh={refresh} /> : <button type="button" disabled={busy || !preorderSaved} onClick={() => void payCredit()} className="mt-3 min-h-11 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on">Pay advance</button>)}</section>}
    {summary.verified ? <section className="mt-5 rounded-2xl border border-line bg-surface p-4"><p className="font-semibold">Mobile verified · {summary.name}</p><p className="mt-1 text-sm text-muted">{summary.phone}</p>{summary.creditPaidPaise >= summary.creditRequiredPaise && !summary.manualConfirmedAt && <button type="button" disabled={busy || !preorderSaved} onClick={() => void confirm()} className="mt-3 min-h-11 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on">Confirm booking</button>}</section> : <div className="mt-5 grid gap-3"><label className="text-sm font-semibold">Name<input value={name} onChange={e => setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3" /></label><label className="text-sm font-semibold">Phone<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={marketing} onChange={e => setMarketing(e.target.checked)} /> Send me occasional offers</label><button type="button" disabled={busy || !name || !phone} onClick={() => void send()} className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-brand-on">Send OTP</button>{challenge && <><label className="text-sm font-semibold">One-time code<input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={4} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 tracking-[.3em]" /></label>{devCode && <p className="rounded-xl bg-paper p-3 text-sm">Demo OTP: <strong>{devCode}</strong></p>}<button type="button" disabled={busy || code.length !== 4 || !preorderSaved && Object.values(qty).some(Boolean)} onClick={() => void verify()} className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-brand-on">Verify and continue</button></>}</div>}{message && <p role="status" className="mt-4 rounded-xl bg-paper p-3 text-sm">{message}</p>}<p className="mt-5 text-xs text-muted">Booking works without marketing consent. Free cancellation is available up to two hours before the reservation.</p>
  </main>;
}
