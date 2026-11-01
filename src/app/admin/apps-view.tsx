"use client";
import { useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Release = { id: string; version: string; url: string; sizeBytes: number; notes: string | null; createdAt: string | Date };
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = (v: string | Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(v));

/** Rider app versions: upload a new APK; the newest is what /download/rider gives */
export function AppsView({ initial }: { initial: Release[] }) {
  const [releases, setReleases] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = releases[0];
  return (
    <div className="space-y-4">
      <div className="md:pr-44"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Apps</h1><p className="mt-1 text-sm text-muted-foreground">The Android app your riders use.</p></div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
        <div className="min-w-0">
          <p className="font-semibold">Tableeqr Rider</p>
          <p className="text-sm text-muted-foreground">{latest ? `Version ${latest.version} is live · ${mb(latest.sizeBytes)}` : "No version uploaded yet"}</p>
        </div>
        <a href="/download/rider" target="_blank" rel="noreferrer" className={`${buttonVariants({ variant: "outline" })} w-full sm:w-auto`}>Open download page</a>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>Upload new version</CardTitle><CardDescription>Riders get it as soon as it uploads.</CardDescription></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setMsg(null);
              const form = e.currentTarget;
              try {
                const res = await fetch("/admin/app-releases", { method: "POST", body: new FormData(form) });
                const data = await res.json();
                if (data.ok) { setReleases(data.releases); setMsg({ ok: true, text: "Uploaded. Riders now get this version." }); form.reset(); }
                else setMsg({ ok: false, text: data.error });
              } catch { setMsg({ ok: false, text: "Upload failed. Check your connection." }); } finally { setBusy(false); }
            }}>
              <div className="space-y-1.5"><Label htmlFor="app-version">Version</Label><Input id="app-version" name="version" required placeholder="1.0.1" /></div>
              <div className="space-y-1.5"><Label htmlFor="app-file">APK file</Label><input id="app-file" name="apk" type="file" accept=".apk,application/vnd.android.package-archive" required className="block w-full text-sm text-muted-foreground file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-solid file:bg-card file:px-3 file:text-sm file:font-semibold file:text-foreground" /></div>
              <div className="space-y-1.5"><Label htmlFor="app-notes">What changed</Label><Input id="app-notes" name="notes" placeholder="Optional" maxLength={300} /></div>
              {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
              <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy ? <Loader2 className="animate-spin" /> : <Upload />}{busy ? "Uploading…" : "Upload"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Versions</CardTitle></CardHeader>
          <CardContent>
            {releases.length ? <ul className="divide-y">{releases.map((r, i) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">Version {r.version}{i === 0 && <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Live</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{when(r.createdAt)} · {mb(r.sizeBytes)}</p>
                  {r.notes && <p className="mt-0.5 text-xs text-muted-foreground">{r.notes}</p>}
                </div>
                <a href={r.url} aria-label={`Download version ${r.version}`} className={buttonVariants({ variant: "outline", size: "icon-sm" })}><Download /></a>
              </li>
            ))}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">Upload the first version to see it here.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
