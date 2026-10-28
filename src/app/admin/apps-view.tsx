"use client";
import { useState } from "react";

type Release = { id: string; version: string; url: string; sizeBytes: number; notes: string | null; createdAt: string | Date };
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Rider app versions: upload a new APK; the newest is what /download/rider gives */
export function AppsView({ initial }: { initial: Release[] }) {
  const [releases, setReleases] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = releases[0];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#e2e5ec] bg-white p-5">
        <p className="text-sm font-semibold text-[#172033]">Tableeqr Rider app</p>
        <p className="mt-1 text-sm text-muted-foreground">Riders download it from <a className="font-semibold text-[#5b42f5]" href="/download/rider" target="_blank" rel="noreferrer">/download/rider</a>. {latest ? `Now giving version ${latest.version} (${mb(latest.sizeBytes)}).` : "No version uploaded yet."}</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr]" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setMsg(null);
          const form = e.currentTarget;
          try {
            const res = await fetch("/admin/app-releases", { method: "POST", body: new FormData(form) });
            const data = await res.json();
            if (data.ok) { setReleases(data.releases); setMsg({ ok: true, text: "Uploaded. Riders now get this version." }); form.reset(); }
            else setMsg({ ok: false, text: data.error });
          } catch { setMsg({ ok: false, text: "Upload failed. Check your connection." }); } finally { setBusy(false); }
        }}>
          <input name="version" required placeholder="1.0.1" className="h-10 rounded-lg border border-[#e2e5ec] px-3 text-sm" />
          <input name="apk" type="file" accept=".apk,application/vnd.android.package-archive" required className="text-sm" />
          <input name="notes" placeholder="What changed (optional)" maxLength={300} className="h-10 rounded-lg border border-[#e2e5ec] px-3 text-sm sm:col-span-2" />
          <button disabled={busy} className="h-10 rounded-lg bg-[#5b42f5] px-4 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2 sm:justify-self-start">{busy ? "Uploading…" : "Upload new version"}</button>
        </form>
        {msg && <p role="status" className={`mt-3 text-sm font-semibold ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      </div>
      <div className="rounded-2xl border border-[#e2e5ec] bg-white">
        {releases.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef0f4] px-5 py-3 last:border-b-0">
            <div><p className="text-sm font-semibold text-[#172033]">Version {r.version}{i === 0 && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Live</span>}</p><p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("en-IN")} · {mb(r.sizeBytes)}{r.notes ? ` · ${r.notes}` : ""}</p></div>
            <a href={r.url} className="text-sm font-semibold text-[#5b42f5]">Download</a>
          </div>
        ))}
      </div>
    </div>
  );
}
