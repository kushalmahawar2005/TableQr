"use client";
import Script from "next/script";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectWhatsAppAction, disconnectWhatsAppAction, submitWhatsAppTemplateAction, syncWhatsAppTemplatesAction } from "./actions";
import type { whatsappOverview } from "@/server/whatsapp/accounts";

type Config = { appId: string; configId: string; version: string };
type SDK = { init: (config: unknown) => void; login: (callback: (response: { authResponse?: { code?: string } }) => void, options: unknown) => void };
const facebook = () => (window as Window & { FB?: SDK }).FB;

export function WhatsAppConnection({ config, nonce, data }: { config: Config | null; nonce: string; data: Awaited<ReturnType<typeof whatsappOverview>> }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [signup, setSignup] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const attempt = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string; pin: string; sending?: boolean } | null>(null);
  const finishRef = useRef<() => void>(() => {});
  const run = (work: () => Promise<{ error: string | null }>, message: string) => {
    setError(null); setNotice(null);
    start(async () => {
      try { const result = await work(); if (result.error) setError(result.error); else { setNotice(message); router.refresh(); } }
      catch { setError("The request was interrupted. Refresh the account status before retrying."); }
    });
  };
  useEffect(() => {
    finishRef.current = () => {
      const value = attempt.current;
      if (!value?.code || !value.wabaId || !value.phoneNumberId || value.sending) return;
      value.sending = true;
      const input = { code: value.code, wabaId: value.wabaId, phoneNumberId: value.phoneNumberId, pin: value.pin };
      run(async () => { try { return await connectWhatsAppAction(input); } finally { attempt.current = null; setSignup(false); setPin(""); } }, "WhatsApp account connected. Sync your templates next.");
    };
  });
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin) || !attempt.current) return;
      let message;
      try { message = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
      if (message?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (message.event === "FINISH" && typeof message.data?.waba_id === "string" && typeof message.data?.phone_number_id === "string") {
        attempt.current.wabaId = message.data.waba_id;
        attempt.current.phoneNumberId = message.data.phone_number_id;
        finishRef.current();
      } else if (message.event === "CANCEL" || message.event === "ERROR") {
        attempt.current = null; setSignup(false); setError("WhatsApp signup was not completed. You can try again.");
      }
    };
    window.addEventListener("message", listener);
    return () => { window.removeEventListener("message", listener); attempt.current = null; };
  }, []);
  const connect = () => {
    if (!config || !facebook() || !/^\d{6}$/.test(pin)) return;
    setError(null); setNotice(null); setSignup(true);
    attempt.current = { pin };
    facebook()!.login((response) => {
      if (!attempt.current) return;
      if (!response.authResponse?.code) { attempt.current = null; setSignup(false); setError("WhatsApp signup was not completed."); return; }
      attempt.current.code = response.authResponse.code;
      finishRef.current();
    }, { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } });
  };
  const busy = pending || signup;
  const button = "rounded-lg border px-4 py-2 text-sm disabled:opacity-50";
  return <section className="space-y-4 rounded-xl border bg-surface p-4">
    {config && <Script nonce={nonce} id="whatsapp-facebook-sdk" src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" onReady={() => { facebook()?.init({ appId: config.appId, version: config.version, xfbml: false, cookie: false }); setReady(!!facebook()); }} onError={() => setError("Meta signup could not load. Check your connection or browser blocker.")} />}
    <h2 className="text-lg font-semibold">Your WhatsApp Business account</h2>
    {!config && <p className="text-sm text-muted-foreground">WhatsApp connection setup is pending with Tableeqr.</p>}
    {data.account && <div className="text-sm"><p>{data.account.verifiedName ?? "WhatsApp Business"} · {data.account.displayPhone ?? "Number not connected"}</p><p>Status: {data.account.status} · Quality: {data.account.qualityRating ?? "Not available"} · Messaging tier: {data.account.messagingTier ?? "Not available"}</p></div>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {config && data.account?.status !== "connected" && <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Six-digit WhatsApp registration PIN<input className="mt-1 block rounded-lg border bg-transparent p-2" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label><button className={button} disabled={busy || !ready || pin.length !== 6} onClick={connect}>Connect with Meta</button></div>}
    {signup && !pending && <button className={button} onClick={() => { attempt.current = null; setSignup(false); }}>Cancel signup</button>}
    {data.account?.status === "connected" && <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => run(syncWhatsAppTemplatesAction, "Template statuses updated from Meta.")}>Sync templates</button><button className={button} disabled={busy} onClick={() => { if (window.confirm("Disconnect WhatsApp? Campaigns will not be able to send until you reconnect.")) run(disconnectWhatsAppAction, "WhatsApp disconnected."); }}>Disconnect</button></div>}
    {data.account?.status === "connected" && <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Submit a marketing template</summary><form className="mt-3 grid gap-3" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      run(() => submitWhatsAppTemplateAction({ name: String(f.get("name")), language: String(f.get("language")), body: String(f.get("body")), examples: String(f.get("examples") ?? "").split("\n").map((v) => v.trim()).filter(Boolean), header: "none" }), "Template submitted to Meta. Sync to see its approval status.");
    }}><label className="text-sm">Template name<input name="name" pattern="[a-z][a-z0-9_]*" maxLength={512} placeholder="weekend_offer" className="block w-full rounded-lg border bg-transparent p-2" required /></label><label className="text-sm">Language<select name="language" className="block rounded-lg border bg-surface p-2"><option value="en">English</option><option value="hi">Hindi</option><option value="en_US">English (US)</option></select></label><label className="text-sm">Message<textarea name="body" maxLength={1024} className="block w-full rounded-lg border bg-transparent p-2" placeholder="Hi {{1}}, visit us this weekend!" required /></label><label className="text-sm">Example values, one per line<textarea name="examples" className="block w-full rounded-lg border bg-transparent p-2" placeholder="Kushal" /></label><p className="text-xs text-muted-foreground">Photo/video templates created in Meta Business Manager can be imported using Sync templates.</p><button className={button} disabled={busy} type="submit">Submit for Meta approval</button></form></details>}
    {data.templates.length > 0 && <ul className="divide-y">{data.templates.map((template) => <li key={template.id} className="space-y-1 py-3 text-sm"><p className="font-medium">{template.name} · {template.language} · {template.status}</p><p className="whitespace-pre-wrap">{template.body}</p><p className="text-xs text-muted-foreground">{template.category} · {template.header} header</p>{template.rejectionReason && <p className="text-red-600">{template.rejectionReason}</p>}</li>)}</ul>}
  </section>;
}
