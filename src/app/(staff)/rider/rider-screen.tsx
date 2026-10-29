"use client";
import { AlertTriangle, BadgeCheck, Banknote, Bike, Camera, Check, ShieldAlert, ChefHat, CircleCheck, Loader2, MapPin, Navigation, Package, Phone, QrCode, Star, Store, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { shrinkPhotoFile } from "@/lib/shrink-photo";
import type { riderJobs, riderProfile } from "@/server/delivery/riders";
import type { RiderVerification } from "@/server/delivery/rider-docs";
import { connectRealtime } from "@/lib/realtime-client";
import { riderCashAction, riderDeliveredAction, riderJobsAction, riderLocationAction, riderOnlineAction, riderPaymentIssueAction, riderPickUpAction, riderProfileAction, riderQrAction, riderQrStatusAction, riderSaveProfileAction, riderTokenAction, riderUpiReceivedAction, submitDocumentsAction } from "./actions";
import type { RiderQr } from "@/server/delivery/rider-pay";
import { LiveMap } from "@/components/live-map";
import { signOutRiderAction } from "./login/actions";
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
  const [locationPermission, setLocationPermission] = useState<"checking" | "prompt" | "granted" | "denied" | "unsupported">("checking");
  const [editing, setEditing] = useState(!initialProfile.photoUrl || !initialProfile.vehicleNo);
  // A rider without a photo or vehicle number starts on Me to finish their profile
  const [tab, setTab] = useState<"rides" | "me">(!initialProfile.photoUrl || !initialProfile.vehicleNo ? "me" : "rides");

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
  useAppTopInset();

  useEffect(() => {
    if (!navigator.geolocation) { queueMicrotask(() => setLocationPermission("unsupported")); return; }
    if (!navigator.permissions?.query) { queueMicrotask(() => setLocationPermission("prompt")); return; }
    void navigator.permissions.query({ name: "geolocation" } as PermissionDescriptor).then((permission) => {
      setLocationPermission(permission.state === "prompt" ? "prompt" : permission.state);
      permission.onchange = () => setLocationPermission(permission.state === "prompt" ? "prompt" : permission.state);
    }).catch(() => setLocationPermission("prompt"));
  }, []);

  const requestLocation = () => {
    const background = nativeBackgroundGeolocation();
    if (background) {
      void background.addWatcher(
        { backgroundTitle: "Tableeqr Rider", backgroundMessage: "Location is shared only while you are online", requestPermissions: true, stale: false, distanceFilter: 30 },
        (_location, reason) => { if (reason) setLocationPermission("denied"); },
      ).then((id) => {
        setLocationPermission("granted");
        return background.removeWatcher({ id });
      }).catch(() => setLocationPermission("denied"));
      return;
    }
    if (!navigator.geolocation) { setLocationPermission("unsupported"); return; }
    navigator.geolocation.getCurrentPosition(
      () => setLocationPermission("granted"),
      (reason) => setLocationPermission(reason.code === reason.PERMISSION_DENIED ? "denied" : "prompt"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  };

  const act = (work: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await work();
      if (!r.ok) setError(r.error ?? "Could not update.");
      const [fresh, me] = await Promise.all([riderJobsAction(), riderProfileAction()]);
      if (fresh.ok) setJobs(fresh.data);
      // Rides and rating move after a delivery
      if (me.ok) setProfile((old) => ({ ...old, stats: me.data.stats }));
    });
  };
  const live = jobs.jobs.filter((j) => j.status !== "delivered");
  const delivered = jobs.jobs.filter((j) => j.status === "delivered");

  const cashDue = live.filter((j) => !j.paid).reduce((n, j) => n + j.totalPaise, 0);
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 pt-4 pb-28 text-ink">
      {/* Who I am, and whether I take deliveries now */}
      <header className="flex items-center gap-3">
        <Avatar url={profile.photoUrl} name={profile.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-section font-bold">{profile.name}</p>
          <p className="truncate text-caption text-muted">{profile.vehicleNo ?? "Add your vehicle number in Me"}</p>
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

      {!profile.online && locationPermission === "prompt" && <aside className="mt-3 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-brand-strong" aria-hidden="true" /><p className="text-caption text-muted">Allow location so the restaurant and customers can track your delivery while you are online.</p></div><button type="button" onClick={requestLocation} className="min-h-10 shrink-0 rounded-xl bg-brand px-3 text-caption font-bold text-brand-on">Allow location</button></aside>}
      {!profile.online && locationPermission === "denied" && <p role="status" className="mt-3 rounded-xl bg-[var(--state-held-soft)] p-3 text-caption text-[var(--state-held-text)]">Location is blocked. Allow it for Tableeqr Rider in your phone or browser settings, then go online to share your location.</p>}
      {!profile.online && locationPermission === "unsupported" && <p role="status" className="mt-3 rounded-xl bg-[var(--state-held-soft)] p-3 text-caption text-[var(--state-held-text)]">This device does not support location sharing.</p>}

      {error && <p role="alert" className="mt-4 rounded-2xl border border-danger/30 bg-[var(--state-seated-soft)] p-3 text-body font-semibold text-danger">{error}</p>}

      {tab === "rides" ? <>
        <p className={`mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 text-caption font-semibold ${!profile.online ? "bg-ink/5 text-muted" : here.error ? "bg-[var(--state-held-soft)] text-[var(--state-held-text)]" : "bg-[var(--state-available-soft)] text-[var(--state-available-text)]"}`}>
          <MapPin className="size-4" aria-hidden="true" />
          {!profile.online ? "Location is off while you are offline" : here.error ?? (here.point ? "Sharing your live location with the restaurant and customer" : "Finding your location…")}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {([[Bike, "Active", String(live.length)], [CircleCheck, "Delivered today", String(delivered.length)], [Banknote, "To collect", money(cashDue)]] as const).map(([Icon, label, value]) => (
            <div key={label} className="rounded-2xl border border-line bg-surface p-3">
              <p className="flex items-center gap-1.5 text-label font-semibold text-muted"><Icon className="size-3.5 shrink-0" aria-hidden="true" />{label}</p>
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
      </> : <>
        {/* Me: the rider's own record and profile */}
        <section className="mt-4 overflow-hidden rounded-3xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-2 bg-brand-soft/50 px-4 pt-6 pb-5 text-center">
            {/* Staff photos live in the photo bucket, so this stays a plain image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {profile.photoUrl ? <img src={profile.photoUrl} alt="" className="size-24 rounded-full object-cover ring-4 ring-surface" /> : <span className="grid size-24 place-items-center rounded-full bg-surface text-brand-strong ring-4 ring-surface"><UserRound className="size-10" aria-hidden="true" /></span>}
            <p className="font-display text-title font-bold">{profile.name}</p>
            <p className="text-caption text-muted">{profile.phone}{profile.vehicleNo ? ` · ${profile.vehicleNo}` : ""}</p>
            <p className="inline-flex items-center gap-1 text-body font-bold"><Star className="size-4 fill-[var(--state-held)] text-[var(--state-held)]" aria-hidden="true" />{profile.stats.rating !== null ? <>{profile.stats.rating.toFixed(1)} <span className="font-medium text-muted">· {profile.stats.ratings} {profile.stats.ratings === 1 ? "rating" : "ratings"}</span></> : <span className="font-medium text-muted">No ratings yet</span>}</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-line border-t border-line text-center">
            {([["Total rides", String(profile.stats.rides)], ["Today", String(profile.stats.today)], ["Rating", profile.stats.rating !== null ? profile.stats.rating.toFixed(1) : "–"]] as const).map(([label, value]) => (
              <div key={label} className="px-2 py-3"><p className="font-display text-title font-bold tabular">{value}</p><p className="text-label font-semibold text-muted">{label}</p></div>
            ))}
          </div>
        </section>

        <VerificationCard initial={initialVerification} hasPhoto={!!profile.photoUrl} />

        {editing ? <ProfileForm profile={profile} onSaved={(p) => { setProfile((old) => ({ ...old, ...p })); setEditing(false); }} />
          : <button type="button" onClick={() => setEditing(true)} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-body font-semibold"><Camera className="size-4" aria-hidden="true" />Edit photo and vehicle</button>}

        <form action={signOutRiderAction}><button className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl border border-line bg-surface text-body font-semibold text-danger">Sign out</button></form>
      </>}

      {/* Bottom tabs: the work, and me */}
      <nav aria-label="Rider navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-2">
          {([["rides", Bike, "Rides", live.length], ["me", UserRound, "Me", 0]] as const).map(([key, Icon, label, badge]) => (
            <button key={key} type="button" aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); window.scrollTo({ top: 0 }); }} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-caption font-semibold ${tab === key ? "text-brand-strong" : "text-muted"}`}>
              <span className={`relative grid h-7 w-14 place-items-center rounded-full ${tab === key ? "bg-brand-soft" : ""}`}><Icon className="size-5" aria-hidden="true" />{badge > 0 && <span className="absolute -top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-bold text-brand-on">{badge}</span>}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}

function JobCard({ job, pickup, pending, act, here, photoUrl }: { job: Job; pickup: Jobs["pickup"]; pending: boolean; act: (w: () => Promise<{ ok: boolean; error?: string }>) => void; here: { lat: number; lng: number } | null; photoUrl: string | null }) {
  const address = job.address;
  if (!address) return <article className="rounded-3xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
    <h2 className="font-bold">Delivery address missing</h2>
    <p className="mt-1 text-sm">This order has no delivery address, so don’t start the delivery. Call the customer and ask the outlet team to check it.</p>
    <a href={`tel:${job.phone}`} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold"><Phone className="size-4" aria-hidden="true" />Call customer</a>
  </article>;
  const drop = `${address.line}, ${address.locality}, ${address.pincode}`;
  // Navigation goes to the customer's pin when they dropped one, else to the typed address
  const dropTarget = address.lat !== undefined && address.lng !== undefined ? `${address.lat},${address.lng}` : drop;
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
          {address.instructions && <p className="mt-0.5 text-caption text-muted">Note: {address.instructions}</p>}
        </li>
      </ol>

      {onWay && here && address.lat !== undefined && address.lng !== undefined && (
        <div className="mx-4 mt-4">
          <LiveMap className="h-56" route points={[{ id: "me", kind: "rider", lat: here.lat, lng: here.lng, photoUrl, label: "You" }, { id: "home", kind: "home", lat: address.lat, lng: address.lng!, label: job.name ?? "Customer" }]}
            overlay={<p className="text-caption font-bold text-ink">🛵 {etaMinutes(distanceKm(here, { lat: address.lat, lng: address.lng! }))} min <span className="font-medium text-muted">· {distanceKm(here, { lat: address.lat, lng: address.lng! }).toFixed(1)} km</span></p>} />
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

      <PayBox job={job} onWay={onWay} pending={pending} act={act} />

      <div className="px-4 pb-4">
        {!onWay ? (
          <button type="button" disabled={pending || !job.kitchenReady} onClick={() => act(() => riderPickUpAction(job.id))} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-button font-bold text-brand-on shadow-[0_8px_20px_-6px_var(--brand-border)] disabled:bg-line disabled:text-muted disabled:shadow-none">
            <Package className="size-5" aria-hidden="true" />{job.kitchenReady ? "Picked up · start delivery" : "Wait for the kitchen"}
          </button>
        ) : (
          <DeliverWithPin job={job} pending={pending} act={act} />
        )}
      </div>
    </article>
  );
}

/** Money at the door: QR first (Cashfree confirms by itself; the restaurant's UPI needs a look), cash, or a reported problem */
function PayBox({ job, onWay, pending, act }: { job: Job; onWay: boolean; pending: boolean; act: (w: () => Promise<{ ok: boolean; error?: string }>) => void }) {
  const [mode, setMode] = useState<"idle" | "qr" | "issue">("idle");
  const [qr, setQr] = useState<RiderQr | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "waiting" | "paid" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [utr, setUtr] = useState("");
  const [issueMethod, setIssueMethod] = useState<"cash" | "upi">("cash");
  const [note, setNote] = useState("");

  const openQr = async () => {
    setMode("qr"); setError(null); setState("loading"); setQr(null); setQrImage(null);
    const r = await riderQrAction(job.id);
    if (!r.ok) { setError(r.error); setState("failed"); return; }
    setQr(r.data);
    if (r.data.kind === "paid") { setState("paid"); act(async () => ({ ok: true })); return; }
    setState("waiting");
    const link = r.data.link;
    if (r.data.kind === "gateway" && r.data.image) setQrImage(r.data.image);
    else if (link) setQrImage(await import("qrcode").then((q) => q.toDataURL(link, { margin: 1, width: 320 })));
  };

  // Cashfree QR: ask every 3 seconds until it is paid; the screen turns green on its own
  const paymentId = qr?.kind === "gateway" ? qr.paymentId : null;
  const actRef = useRef(act);
  useEffect(() => { actRef.current = act; });
  useEffect(() => {
    if (!paymentId || state !== "waiting") return;
    let live = true;
    const tick = async () => {
      const r = await riderQrStatusAction(job.id, paymentId);
      if (!live || !r.ok) return;
      if (r.data.status === "paid") { setState("paid"); navigator.vibrate?.([80, 60, 160]); actRef.current(async () => ({ ok: true })); }
      if (r.data.status === "failed") { setState("failed"); setError("The payment failed. Make a new QR, or take cash."); }
    };
    const t = window.setInterval(() => void tick(), 3000);
    return () => { live = false; window.clearInterval(t); };
  }, [paymentId, state, job.id]);

  if (job.paid) return (
    <div className="m-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--state-available)]/40 bg-[var(--state-available-soft)] p-3">
      <div><p className="text-label text-[var(--state-available-text)]">Payment done</p><p className="font-display text-title font-bold leading-none tabular">{money(job.totalPaise)}</p></div>
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--state-available)] px-3 py-1 text-caption font-bold text-white"><Check className="size-3.5" aria-hidden="true" />Paid</span>
      {job.paymentIssue && <p className="basis-full text-caption text-[var(--state-held-text)]">Issue noted: {job.paymentIssue}</p>}
    </div>
  );

  return (
    <div className="m-4 rounded-2xl border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-label text-muted">Collect from customer</p><p className="font-display text-title font-bold leading-none tabular">{money(job.totalPaise)}</p></div>
        {!onWay && <span className="text-caption text-muted">After pick up</span>}
      </div>
      {onWay && mode === "idle" && (
        <div className="mt-3 grid gap-2">
          <button type="button" disabled={pending} onClick={() => void openQr()} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ink text-body font-bold text-white disabled:opacity-50"><QrCode className="size-5" aria-hidden="true" />Show payment QR</button>
          <button type="button" disabled={pending} onClick={() => { if (window.confirm(`Collected ${money(job.totalPaise)} in cash?`)) act(() => riderCashAction(job.id, `cash-${job.id}`)); }} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line text-body font-bold disabled:opacity-50"><Banknote className="size-5" aria-hidden="true" />Cash received</button>
          <button type="button" onClick={() => { setMode("issue"); setError(null); }} className="min-h-10 text-caption font-semibold text-muted underline underline-offset-2">Payment problem?</button>
        </div>
      )}
      {onWay && mode === "qr" && (
        <div className="mt-3 grid justify-items-center gap-3 text-center">
          {state === "paid" ? (
            <div className="grid w-full justify-items-center gap-2 rounded-2xl bg-[var(--state-available-soft)] p-5 text-[var(--state-available-text)]">
              <span className="grid size-14 place-items-center rounded-full bg-[var(--state-available)] text-white"><Check className="size-8" aria-hidden="true" /></span>
              <p className="text-section font-bold">Payment successful</p><p className="text-caption">{money(job.totalPaise)} received. Now take the PIN and finish.</p>
            </div>
          ) : (
            <>
              {/* QR images come as data URLs */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qrImage ? <img src={qrImage} alt="Payment QR" className="size-60 rounded-2xl bg-white p-2" /> : <div className="grid size-60 place-items-center rounded-2xl bg-paper">{state === "loading" ? <Loader2 className="size-8 animate-spin text-muted" aria-hidden="true" /> : <QrCode className="size-10 text-muted" aria-hidden="true" />}</div>}
              {qr?.kind === "gateway" && state === "waiting" && <p className="inline-flex items-center gap-2 text-caption font-semibold text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Waiting for payment… it turns green by itself</p>}
              {qr?.kind === "upi" && <>
                <p className="text-caption text-muted">Pays to {qr.upiId}. Check the customer&apos;s screen shows <b>{money(qr.amountPaise)}</b> paid.</p>
                <input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} maxLength={40} inputMode="text" placeholder="UPI reference / UTR (optional)" className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-body" />
                <button type="button" disabled={pending} onClick={() => act(() => riderUpiReceivedAction(job.id, utr))} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--state-available)] text-body font-bold text-white disabled:opacity-50"><Check className="size-5" aria-hidden="true" />UPI received</button>
              </>}
            </>
          )}
          {error && <p role="alert" className="text-caption font-semibold text-danger">{error}</p>}
          {state !== "paid" && <div className="flex w-full gap-2">
            <button type="button" onClick={() => setMode("idle")} className="min-h-11 flex-1 rounded-2xl border border-line text-caption font-semibold">Back</button>
            <button type="button" onClick={() => { setMode("issue"); setError(null); }} className="min-h-11 flex-1 rounded-2xl border border-line text-caption font-semibold text-[var(--state-held-text)]">Payment problem?</button>
          </div>}
        </div>
      )}
      {onWay && mode === "issue" && (
        <div className="mt-3 grid gap-3">
          <p className="flex items-start gap-2 rounded-xl bg-[var(--state-held-soft)] p-3 text-caption text-[var(--state-held-text)]"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Take {money(job.totalPaise)} another way and write what happened. The manager will see it.</p>
          <div className="grid grid-cols-2 gap-2">{([["cash", "Took cash"], ["upi", "UPI to restaurant"]] as const).map(([v, label]) => <button key={v} type="button" aria-pressed={issueMethod === v} onClick={() => setIssueMethod(v)} className={`min-h-11 rounded-xl border text-caption font-bold ${issueMethod === v ? "border-ink bg-ink text-white" : "border-line"}`}>{label}</button>)}</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={3} placeholder="What went wrong? e.g. QR not loading, customer's UPI app failed" className="w-full rounded-xl border border-line bg-surface p-3 text-body" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("idle")} className="min-h-12 flex-1 rounded-2xl border border-line text-body font-semibold">Back</button>
            <button type="button" disabled={pending || note.trim().length < 5} onClick={() => act(() => riderPaymentIssueAction(job.id, issueMethod, note))} className="min-h-12 flex-[2] rounded-2xl bg-ink text-body font-bold text-white disabled:opacity-50">Save · payment taken</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Delivered" needs the customer's 4-digit PIN, so food never goes to the wrong door */
function DeliverWithPin({ job, pending, act }: { job: Job; pending: boolean; act: (w: () => Promise<{ ok: boolean; error?: string }>) => void }) {
  const [pin, setPin] = useState("");
  const ready = job.paid && (!job.hasPin || pin.length === 4);
  return (
    <div className="grid gap-2">
      {job.hasPin && (
        <label className="grid gap-1.5 text-caption font-semibold text-muted">
          Ask the customer for their delivery PIN
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" placeholder="• • • •" aria-label="Delivery PIN" className="min-h-14 w-full rounded-2xl border border-line bg-surface text-center font-display text-title font-bold tracking-[0.6em] tabular" />
        </label>
      )}
      <button type="button" disabled={pending || !ready} onClick={() => act(() => riderDeliveredAction(job.id, pin))} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--state-available)] text-button font-bold text-white disabled:bg-line disabled:text-muted">
        <CircleCheck className="size-5" aria-hidden="true" />{!job.paid ? "Take payment first" : job.hasPin && pin.length < 4 ? "Enter PIN to finish" : "Delivered"}
      </button>
    </div>
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
  const [photo, setPhoto] = useState<File | null>(null);
  return (
    <form className="mt-4 grid min-w-0 gap-3 rounded-3xl border border-line bg-surface p-4" onSubmit={(e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      if (photo) form.set("photo", photo);
      setError(null);
      start(async () => {
        try { const r = await riderSaveProfileAction(form); if (r.ok) onSaved(r.data); else setError(r.error); }
        catch { setError(SEND_FAILED); }
      });
    }}>
      <p className="text-body font-bold">Your rider profile</p>
      <p className="-mt-2 text-caption text-muted">Customers see your photo, name and vehicle number when you bring their order.</p>
      <PhotoPicker label={profile.photoUrl ? "Change your photo" : "Add your photo"} hint="A clear photo of your face" capture="user" current={profile.photoUrl} value={photo} onChange={setPhoto} />
      <label className="text-caption font-semibold text-muted">Vehicle number
        <input name="vehicleNo" defaultValue={profile.vehicleNo ?? ""} placeholder="RJ06 AB 1234" maxLength={20} className="mt-1 min-h-12 w-full rounded-2xl border border-line bg-paper px-4 text-body uppercase text-ink" />
      </label>
      {error && <p role="alert" className="text-caption font-semibold text-danger">{error}</p>}
      <button disabled={pending} className="min-h-12 rounded-2xl bg-brand text-button font-bold text-brand-on disabled:opacity-60">{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}

type BackgroundGeolocation = {
  addWatcher(options: Record<string, unknown>, callback: (location?: { latitude: number; longitude: number }, error?: { code: string; message: string }) => void): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
};
/** The background location plugin, when this page runs inside the Tableeqr Rider Android app */
function nativeBackgroundGeolocation(): BackgroundGeolocation | null {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; registerPlugin?: (name: string) => unknown } }).Capacitor;
  return cap?.isNativePlatform?.() && cap.registerPlugin ? (cap.registerPlugin("BackgroundGeolocation") as BackgroundGeolocation) : null;
}

/**
 * While the rider is online, watches the phone's position and sends it every 15 seconds, or
 * sooner after moving 40 m. In a browser this works only while the page is open; inside the
 * Tableeqr Rider Android app it keeps going with the screen off.
 */
function useLiveLocation(online: boolean) {
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!online) return;
    let last: { lat: number; lng: number; t: number } | null = null;
    const report = (p: { lat: number; lng: number }) => {
      setPoint(p);
      setError(null);
      const now = Date.now();
      if (!last || now - last.t > 15_000 || distanceKm(last, p) > 0.04) {
        last = { ...p, t: now };
        void riderLocationAction(p.lat, p.lng);
      }
    };
    // Inside the Tableeqr Rider Android app: a background service keeps sending with the screen off
    const bg = nativeBackgroundGeolocation();
    if (bg) {
      let watcher: string | null = null, stopped = false;
      void bg.addWatcher(
        { backgroundTitle: "Delivering with Tableeqr", backgroundMessage: "Sharing your location while you are online", requestPermissions: true, stale: false, distanceFilter: 30 },
        (loc, err) => {
          if (err) { setError(err.code === "NOT_AUTHORIZED" ? "Allow location for Tableeqr Rider in phone settings." : "Location not available. Turn on GPS."); return; }
          if (loc) report({ lat: loc.latitude, lng: loc.longitude });
        },
      ).then((id) => { if (stopped) void bg.removeWatcher({ id }); else watcher = id; });
      return () => { stopped = true; if (watcher) void bg.removeWatcher({ id: watcher }); };
    }
    if (!("geolocation" in navigator)) { queueMicrotask(() => setError("This phone cannot share location.")); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => report({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
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
  const [sides, setSides] = useState<{ front: File | null; back: File | null }>({ front: null, back: null });
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
        <form className="mt-3 grid min-w-0 gap-3" onSubmit={(e) => {
          e.preventDefault();
          if (!sides.front || !sides.back) { setError("Add photos of both sides of your Aadhaar."); return; }
          const form = new FormData(e.currentTarget);
          form.set("front", sides.front);
          form.set("back", sides.back);
          setError(null);
          start(async () => {
            try { const r = await submitDocumentsAction(form); if (r.ok) { setV(r.data); setOpen(false); } else setError(r.error); }
            catch { setError(SEND_FAILED); }
          });
        }}>
          {!hasPhoto && <p className="rounded-xl bg-[var(--state-held-soft)] p-2 text-caption text-[var(--state-held-text)]">First add your face photo with Edit profile. It is used as your selfie.</p>}
          {(["front", "back"] as const).map((side) => (
            <PhotoPicker key={side} label={`Aadhaar ${side}`} hint={side === "front" ? "The side with your photo" : "The side with your address"} capture="environment" value={sides[side]} onChange={(f) => setSides((cur) => ({ ...cur, [side]: f }))} />
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

const SEND_FAILED = "Could not send. Check your internet and try again.";

/**
 * A photo button: opens the camera or gallery, shrinks the photo on the phone (a camera photo is
 * 3-8 MB, too big to send) and shows it. The form adds the chosen file itself when it is sent.
 */
function PhotoPicker({ label, hint, capture, current = null, value, onChange }: { label: string; hint: string; capture: "user" | "environment"; current?: string | null; value: File | null; onChange: (f: File | null) => void }) {
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const shown = preview ?? current;
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line p-3 transition-colors hover:border-brand/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
      {shown
        // A local preview or the photo bucket, so this stays a plain image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={shown} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
        : <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Camera className="size-5" aria-hidden="true" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold">{label}</span>
        <span className="block truncate text-caption text-muted">{busy ? "Getting the photo ready…" : value ? "Ready · tap to change" : hint}</span>
      </span>
      {value ? <Check className="size-5 shrink-0 text-[var(--state-available)]" aria-hidden="true" /> : <span className="shrink-0 rounded-xl bg-ink/5 px-3 py-2 text-caption font-bold">{shown ? "Change" : "Add"}</span>}
      <input
        type="file"
        accept="image/*"
        capture={capture}
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try { onChange(await shrinkPhotoFile(file)); } finally { setBusy(false); }
        }}
      />
    </label>
  );
}

/**
 * The Android app draws the page under the status bar. When the WebView does not report that
 * space (older WebViews give env(safe-area-inset-top) as 0), leave room for it by hand.
 */
function useAppTopInset() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const probe = document.createElement("div");
    probe.style.paddingTop = "env(safe-area-inset-top)";
    document.body.appendChild(probe);
    const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    if (inset === 0) document.documentElement.style.setProperty("--app-top", "2rem");
  }, []);
}
