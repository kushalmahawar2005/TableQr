"use client";
import { BadgeCheck, Banknote, Bike, Camera, Check, ShieldAlert, ChefHat, CircleCheck, MapPin, Navigation, Package, Phone, Store, UserRound } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import type { riderJobs, riderProfile } from "@/server/delivery/riders";
import type { RiderVerification } from "@/server/delivery/rider-docs";
import { connectRealtime } from "@/lib/realtime-client";
import { riderCashAction, riderDeliveredAction, riderJobsAction, riderLocationAction, riderOnlineAction, riderPickUpAction, riderSaveProfileAction, riderTokenAction, submitDocumentsAction } from "./actions";
import { LiveMap } from "@/components/live-map";
import { distanceKm, etaMinutes } from "@/domain/delivery";

type Jobs = Awaited<ReturnType<typeof riderJobs>>;
type Job = Jobs["jobs"][number];
type Profile = Awaited<ReturnType<typeof riderProfile>>;
const money = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const clock = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
const directions = (q: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`;

export function RiderScreen({ initialJobs, initialProfile, initialVerification, realtimeUrl = null }: { initialJobs: Jobs; initialProfile: Profile; initialVerification: RiderVerification; realtimeUrl?: string | null }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [profile, setProfile] = useState(initialProfile);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!initialProfile.photoUrl || !initialProfile.vehicleNo);

  // New jobs and kitchen progress arrive live; a burst of events is one reload. Without a live
  // connection the list is checked every 20 s.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = async () => { const r = await riderJobsAction(); if (r.ok) setJobs(r.data); };
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: riderTokenAction,
      pollMs: 20_000,
      onResync: () => { if (!document.hidden) void reload(); },
      onEvents: () => { if (!timer) timer = setTimeout(() => { timer = null; void reload(); }, 1000); },
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [realtimeUrl]);

  const here = useLiveLocation(profile.online);

  const act = (work: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await work();
      if (!r.ok) setError(r.error ?? "Could not update.");
      const fresh = await riderJobsAction();
      if (fresh.ok) setJobs(fresh.data);
    });
  };
  const live = jobs.jobs.filter((j) => j.status !== "delivered");
  const delivered = jobs.jobs.filter((j) => j.status === "delivered");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 pt-4 pb-10 text-ink">
      {/* Who I am, and whether I take deliveries now */}
      <header className="flex items-center gap-3">
        <Avatar url={profile.photoUrl} name={profile.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-section font-bold">{profile.name}</p>
          <p className="text-caption text-muted">{profile.vehicleNo ?? "Add your vehicle number"} · <button type="button" className="font-semibold text-brand-strong" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit profile"}</button></p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={profile.online}
          disabled={pending}
          onClick={() => start(async () => { const r = await riderOnlineAction(!profile.online); if (r.ok) setProfile((p) => ({ ...p, online: r.data.online })); else setError(r.error); })}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-body font-bold transition-colors ${profile.online ? "bg-[var(--state-available)] text-white" : "bg-ink/10 text-ink"}`}
        >
          <span className={`size-2.5 rounded-full ${profile.online ? "animate-pulse bg-white" : "bg-muted"}`} aria-hidden="true" />
          {profile.online ? "Online" : "Offline"}
        </button>
      </header>

      <p className={`mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 text-caption font-semibold ${!profile.online ? "bg-ink/5 text-muted" : here.error ? "bg-[var(--state-held-soft)] text-[var(--state-held-text)]" : "bg-[var(--state-available-soft)] text-[var(--state-available-text)]"}`}>
        <MapPin className="size-4" aria-hidden="true" />
        {!profile.online ? "Location is off while you are offline" : here.error ?? (here.point ? "Sharing your live location with the restaurant and customer" : "Finding your location…")}
      </p>

      <VerificationCard initial={initialVerification} hasPhoto={!!profile.photoUrl} />

      {editing && <ProfileForm profile={profile} onSaved={(p) => { setProfile((old) => ({ ...old, ...p })); setEditing(false); }} />}

      {error && <p role="alert" className="mt-4 rounded-2xl border border-danger/30 bg-[var(--state-seated-soft)] p-3 text-body font-semibold text-danger">{error}</p>}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {([[Bike, "Active", String(live.length)], [CircleCheck, "Delivered", String(delivered.length)], [Banknote, "Cash due", money(live.filter((j) => !j.paid).reduce((n, j) => n + j.totalPaise, 0))]] as const).map(([Icon, label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-3">
            <p className="flex items-center gap-1.5 text-label font-semibold text-muted"><Icon className="size-3.5" aria-hidden="true" />{label}</p>
            <p className="mt-1 font-display text-section font-bold tabular">{value}</p>
          </div>
        ))}
      </div>

      {!profile.online && live.length === 0 && <p className="mt-4 rounded-2xl bg-ink/5 p-4 text-center text-body text-muted">You are offline. Go online to get deliveries.</p>}
      {profile.online && live.length === 0 && (
        <div className="mt-6 rounded-3xl border border-dashed border-line p-8 text-center">
          <Bike className="mx-auto size-9 text-muted" aria-hidden="true" />
          <p className="mt-3 font-semibold">Waiting for a delivery</p>
          <p className="mt-1 text-caption text-muted">New orders given to you show up here by themselves.</p>
        </div>
      )}

      <div className="mt-4 grid gap-4">
        {live.map((job) => <JobCard key={job.id} job={job} pickup={jobs.pickup} pending={pending} act={act} here={here.point} photoUrl={profile.photoUrl} />)}
      </div>

      {delivered.length > 0 && (
        <section className="mt-6">
          <h2 className="text-caption font-bold tracking-wide text-muted uppercase">Delivered today</h2>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
            {delivered.map((j) => <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-3"><span className="min-w-0 truncate text-body">{j.name}</span><span className="shrink-0 text-caption text-muted tabular">{clock(j.deliveredAt)} · {money(j.totalPaise)}</span></li>)}
          </ul>
        </section>
      )}
    </main>
  );
}

function JobCard({ job, pickup, pending, act, here, photoUrl }: { job: Job; pickup: Jobs["pickup"]; pending: boolean; act: (w: () => Promise<{ ok: boolean; error?: string }>) => void; here: { lat: number; lng: number } | null; photoUrl: string | null }) {
  const drop = `${job.address.line}, ${job.address.locality}, ${job.address.pincode}`;
  // Navigation goes to the customer's pin when they dropped one, else to the typed address
  const dropTarget = job.address.lat !== undefined && job.address.lng !== undefined ? `${job.address.lat},${job.address.lng}` : drop;
  const onWay = job.status === "dispatched";
  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_4px_18px_rgb(31_41_55/0.06)]">
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${onWay ? "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]" : job.kitchenReady ? "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]" : "bg-[var(--state-held-soft)] text-[var(--state-held-text)]"}`}>
        <p className="flex items-center gap-2 text-body font-bold">
          {onWay ? <><Bike className="size-4" aria-hidden="true" />On the way</> : job.kitchenReady ? <><Package className="size-4" aria-hidden="true" />Ready to pick up</> : <><ChefHat className="size-4" aria-hidden="true" />Kitchen is preparing</>}
        </p>
        <p className="text-caption font-semibold tabular">Placed {clock(job.placedAt)}</p>
      </div>

      {/* Pickup and drop, like a route */}
      <ol className="relative mx-4 mt-4 grid gap-4 border-l-2 border-dashed border-line pl-5">
        <li className={onWay ? "opacity-50" : ""}>
          <span className="absolute -left-[9px] grid size-4 place-items-center rounded-full bg-brand text-brand-on"><Store className="size-2.5" aria-hidden="true" /></span>
          <p className="text-label font-semibold text-muted uppercase">Pick up</p>
          <p className="text-body font-semibold">{pickup.name}</p>
          {pickup.address && <p className="text-caption text-muted">{pickup.address}</p>}
        </li>
        <li>
          <span className="absolute -left-[9px] mt-0.5 grid size-4 place-items-center rounded-full bg-[var(--state-available)] text-white"><MapPin className="size-2.5" aria-hidden="true" /></span>
          <p className="text-label font-semibold text-muted uppercase">Drop</p>
          <p className="text-body font-semibold">{job.name}</p>
          <p className="text-caption text-ink">{drop}</p>
          {job.address.instructions && <p className="mt-0.5 text-caption text-muted">Note: {job.address.instructions}</p>}
        </li>
      </ol>

      {onWay && here && job.address.lat !== undefined && job.address.lng !== undefined && (
        <div className="mx-4 mt-4">
          <LiveMap className="h-56" route points={[{ id: "me", kind: "rider", lat: here.lat, lng: here.lng, photoUrl, label: "You" }, { id: "home", kind: "home", lat: job.address.lat, lng: job.address.lng!, label: job.name ?? "Customer" }]}
            overlay={<p className="text-caption font-bold text-ink">🛵 {etaMinutes(distanceKm(here, { lat: job.address.lat, lng: job.address.lng! }))} min <span className="font-medium text-muted">· {distanceKm(here, { lat: job.address.lat, lng: job.address.lng! }).toFixed(1)} km</span></p>} />
        </div>
      )}

      <div className="mx-4 mt-4 flex gap-2">
        <a href={`tel:${job.phone}`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-line text-body font-semibold"><Phone className="size-4" aria-hidden="true" />Call</a>
        <a href={directions(onWay ? dropTarget : pickup.address || pickup.name)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-line text-body font-semibold"><Navigation className="size-4" aria-hidden="true" />Navigate</a>
      </div>

      {job.items.length > 0 && (
        <ul className="mx-4 mt-3 rounded-2xl bg-paper px-3 py-2">
          {job.items.map((it, i) => <li key={i} className="flex gap-2 py-0.5 text-body"><span className="font-bold tabular">{it.qty}×</span>{it.name}</li>)}
        </ul>
      )}

      <div className="m-4 flex items-center justify-between gap-3 rounded-2xl border border-line p-3">
        <div>
          <p className="text-label text-muted">{job.paid ? "Paid online / recorded" : "Collect cash"}</p>
          <p className="font-display text-title font-bold leading-none tabular">{money(job.totalPaise)}</p>
        </div>
        {job.paid ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--state-available-soft)] px-3 py-1 text-caption font-bold text-[var(--state-available-text)]"><Check className="size-3.5" aria-hidden="true" />Paid</span>
          : onWay && <button type="button" disabled={pending} onClick={() => { if (window.confirm(`Collected ${money(job.totalPaise)} in cash?`)) act(() => riderCashAction(job.id, `cash-${job.id}`)); }} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-ink px-4 text-body font-bold text-white disabled:opacity-50"><Banknote className="size-4" aria-hidden="true" />Cash received</button>}
      </div>

      <div className="px-4 pb-4">
        {!onWay ? (
          <button type="button" disabled={pending || !job.kitchenReady} onClick={() => act(() => riderPickUpAction(job.id))} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-button font-bold text-brand-on shadow-[0_8px_20px_-6px_var(--brand-border)] disabled:bg-line disabled:text-muted disabled:shadow-none">
            <Package className="size-5" aria-hidden="true" />{job.kitchenReady ? "Picked up · start delivery" : "Wait for the kitchen"}
          </button>
        ) : (
          <button type="button" disabled={pending || !job.paid} onClick={() => act(() => riderDeliveredAction(job.id))} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--state-available)] text-button font-bold text-white disabled:bg-line disabled:text-muted">
            <CircleCheck className="size-5" aria-hidden="true" />{job.paid ? "Delivered" : "Take cash first"}
          </button>
        )}
      </div>
    </article>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  // Staff photos live in the photo bucket, so this stays a plain image
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="size-12 shrink-0 rounded-full object-cover ring-2 ring-surface" /> : <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong"><UserRound className="size-6" aria-label={name} /></span>;
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="mt-4 grid gap-3 rounded-3xl border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); setError(null); start(async () => { const r = await riderSaveProfileAction(form); if (r.ok) onSaved(r.data); else setError(r.error); }); }}>
      <p className="text-body font-bold">Your rider profile</p>
      <p className="-mt-2 text-caption text-muted">Customers see your photo, name and vehicle number when you bring their order.</p>
      <label className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-3 text-body font-semibold">
        <Camera className="size-5 text-brand-strong" aria-hidden="true" />{profile.photoUrl ? "Change photo" : "Add your photo"}
        <input name="photo" type="file" accept="image/*" capture="user" className="ml-auto max-w-[45%] text-caption" />
      </label>
      <label className="text-caption font-semibold text-muted">Vehicle number
        <input name="vehicleNo" defaultValue={profile.vehicleNo ?? ""} placeholder="RJ06 AB 1234" maxLength={20} className="mt-1 min-h-12 w-full rounded-2xl border border-line bg-paper px-4 text-body uppercase text-ink" />
      </label>
      {error && <p role="alert" className="text-caption font-semibold text-danger">{error}</p>}
      <button disabled={pending} className="min-h-12 rounded-2xl bg-brand text-button font-bold text-brand-on disabled:opacity-60">{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}

/**
 * While the rider is online, watches the phone's position and sends it every 15 seconds, or
 * sooner after moving 40 m. Works only while this page is open (a browser limit).
 */
function useLiveLocation(online: boolean) {
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!online) return;
    if (!("geolocation" in navigator)) { queueMicrotask(() => setError("This phone cannot share location.")); return; }
    let last: { lat: number; lng: number; t: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPoint(p);
        setError(null);
        const now = Date.now();
        if (!last || now - last.t > 15_000 || distanceKm(last, p) > 0.04) {
          last = { ...p, t: now };
          void riderLocationAction(p.lat, p.lng);
        }
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? "Allow location for this site so customers can track you." : "Location not available. Turn on GPS."),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [online]);
  return { point: online ? point : null, error: online ? error : null };
}

/** Identity check: Aadhaar front and back plus the last 4 digits; the owner verifies */
function VerificationCard({ initial, hasPhoto }: { initial: RiderVerification; hasPhoto: boolean }) {
  const [v, setV] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (v.status === "verified") return <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--state-available-soft)] px-3 py-2 text-caption font-bold text-[var(--state-available-text)]"><BadgeCheck className="size-4" aria-hidden="true" />Verified rider · customers see a verified badge</p>;
  if (v.status === "pending") return <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--state-held-soft)] px-3 py-2 text-caption font-semibold text-[var(--state-held-text)]"><ShieldAlert className="size-4" aria-hidden="true" />Your documents are with the owner for checking</p>;
  return (
    <section className="mt-3 rounded-3xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-brand-strong" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-body font-bold">Get verified</p>
          <p className="text-caption text-muted">{v.status === "rejected" ? `Not approved: ${v.note ?? "please send again"}` : "Customers trust a verified rider. It takes a minute."}</p>
        </div>
        {!open && <button type="button" onClick={() => setOpen(true)} className="min-h-10 shrink-0 rounded-xl bg-brand px-3 text-caption font-bold text-brand-on">{v.status === "rejected" ? "Send again" : "Start"}</button>}
      </div>
      {open && (
        <form className="mt-3 grid gap-3" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); setError(null); start(async () => { const r = await submitDocumentsAction(form); if (r.ok) { setV(r.data); setOpen(false); } else setError(r.error); }); }}>
          {!hasPhoto && <p className="rounded-xl bg-[var(--state-held-soft)] p-2 text-caption text-[var(--state-held-text)]">First add your face photo with Edit profile. It is used as your selfie.</p>}
          {(["front", "back"] as const).map((side) => (
            <label key={side} className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-3 text-body font-semibold">
              <Camera className="size-5 text-brand-strong" aria-hidden="true" />Aadhaar {side}
              <input name={side} type="file" accept="image/*" capture="environment" required className="ml-auto max-w-[50%] text-caption" />
            </label>
          ))}
          <label className="text-caption font-semibold text-muted">Last 4 digits of your Aadhaar
            <input name="last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required placeholder="1234" className="mt-1 min-h-12 w-full rounded-2xl border border-line bg-paper px-4 text-body tracking-[.3em] text-ink" />
          </label>
          <p className="text-label text-muted">Your full Aadhaar number is never saved. The photos are encrypted, seen only by your restaurant&apos;s owner, and deleted after the check.</p>
          <label className="flex items-start gap-2 text-caption text-ink"><input name="consent" type="checkbox" required className="mt-0.5 size-4 accent-[var(--brand-main)]" />I agree to share these for identity verification by my restaurant.</label>
          {error && <p role="alert" className="text-caption font-semibold text-danger">{error}</p>}
          <button disabled={pending || !hasPhoto} className="min-h-12 rounded-2xl bg-brand text-button font-bold text-brand-on disabled:opacity-60">{pending ? "Sending securely…" : "Send for verification"}</button>
        </form>
      )}
    </section>
  );
}
