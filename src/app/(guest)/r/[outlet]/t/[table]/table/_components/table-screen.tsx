"use client";

import {
  AlertCircleIcon,
  ArrowRight01Icon,
  BellRingIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CleanIcon,
  Clock01Icon,
  CrownIcon,
  GlassWaterIcon,
  InformationCircleIcon,
  Invoice01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  QrCodeIcon,
  Restaurant01Icon,
  Share08Icon,
  UserGroupIcon,
  UserIcon,
  UserRemove01Icon,
  UserSwitchIcon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { formatRupees } from "@/domain/menu-price";
import { initials, personLabel } from "@/domain/table-people";
import type { Lang } from "@/lib/i18n";
import type { ServiceKind } from "@/server/guest/service-requests";
import type { TableScreenData } from "@/server/guest/table-screen";
import { DiningNav } from "../../_components/dining-nav";
import { LanguageToggle } from "../../_components/language-toggle";
import { OutletLogo } from "../../_components/outlet-logo";
import { serviceRequestAction } from "../../orders/actions";
import { g6Copy } from "../../orders/_copy";
import { passHostAction, removePersonAction, setOrderingAction, type HostError } from "../actions";
import { g7Copy, type G7Copy } from "../_copy";
import { useTableSync } from "../_hooks/use-table-sync";

type Person = TableScreenData["people"][number];
type Notice = { text: string; error?: boolean };
type Confirm = { kind: "remove" | "pass"; person: Person } | { kind: "bill" };

/** The table's own address and its QR, made on the server; never carries a participant or secret */
export type InviteLink = { url: string; display: string; qrPath: string; qrBox: number };

/** A frozen state for the dev review board */
export type TablePreview = {
  offline?: boolean;
  failed?: boolean;
  sheet?: "invite" | "manage" | "person";
  confirm?: "remove" | "pass" | "bill";
  /** Who the person sheet or confirmation is about */
  targetId?: string;
  notice?: Notice;
};

const serviceIcons: Record<ServiceKind, IconSvgElement> = {
  water: GlassWaterIcon,
  cutlery: Restaurant01Icon,
  call_waiter: BellRingIcon,
  clean_table: CleanIcon,
  request_bill: Invoice01Icon,
};

const AVATAR_TONES = [
  "bg-brand-soft text-brand-strong",
  "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
  "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
];

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const button = `inline-flex min-h-12 items-center justify-center gap-1.5 rounded-cta px-4 py-2.5 text-button font-semibold transition-colors duration-150 ease-natural disabled:cursor-not-allowed disabled:opacity-55 ${focus}`;
const outline = `${button} border border-line bg-surface text-ink hover:border-ink/40`;

export function TableScreen({
  data: initial,
  lang,
  shortCode,
  realtimeUrl,
  invite,
  preview,
}: {
  data: TableScreenData;
  lang: Lang;
  shortCode: string;
  realtimeUrl: string | null;
  invite: InviteLink;
  preview?: TablePreview;
}) {
  const c = g7Copy[lang];
  const s6 = g6Copy[lang];
  const router = useRouter();
  const { data, clock, online, failed, refresh } = useTableSync(initial, shortCode, realtimeUrl, !!preview, preview?.offline);
  const { session } = data;
  const tablePath = `/r/${encodeURIComponent(data.outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const billRequested = session.status === "bill_requested";
  const canManage = session.isHost && !billRequested;
  const labels = { you: c.you, youSuffix: c.youSuffix, anotherGuest: c.anotherGuest };
  const fullName = (p: Person) => personLabel(p, labels);
  const shortName = (p: Person) => p.name ?? c.anotherGuest;

  const active = data.people.filter((p) => p.state === "active");
  const paid = data.people.filter((p) => p.state === "paid");
  const others = active.filter((p) => !p.isMe);
  const previewTarget = preview?.targetId ? (initial.people.find((p) => p.id === preview.targetId) ?? null) : null;

  const [sheet, setSheet] = useState<"invite" | "manage" | null>(() => (preview?.sheet === "invite" || preview?.sheet === "manage" ? preview.sheet : null));
  const [personSheet, setPersonSheet] = useState<Person | null>(() => (preview?.sheet === "person" ? previewTarget : null));
  const [confirm, setConfirm] = useState<Confirm | null>(() =>
    preview?.confirm === "bill" ? { kind: "bill" } : preview?.confirm && previewTarget ? { kind: preview.confirm, person: previewTarget } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(() => preview?.notice ?? null);
  const attempts = useRef<Partial<Record<ServiceKind, string>>>({});

  const closeAll = () => {
    setConfirm(null);
    setPersonSheet(null);
    setSheet(null);
  };

  /** One server change at a time; the screen then reloads from the database */
  async function run(key: string, call: () => Promise<{ ok: true } | { ok: false; error: HostError }>, success: string) {
    if (preview) {
      closeAll();
      return;
    }
    if (busyRef.current || !online) return;
    busyRef.current = true;
    setBusy(key);
    setNotice(null);
    try {
      const res = await call();
      if (!res.ok) {
        if (res.error === "gone") {
          router.replace(tablePath);
          return;
        }
        const text = { host_only: c.hostOnlyAction, blocked: c.settlingNoChanges, changed: c.changed, failed: c.failed }[res.error];
        setNotice({ text, error: res.error === "failed" });
      } else {
        setNotice({ text: success });
      }
      await refresh();
    } catch {
      setNotice({ text: c.failed, error: true });
    } finally {
      busyRef.current = false;
      setBusy(null);
      closeAll();
    }
  }

  const toggleOrdering = () => {
    const lock = !session.orderingLocked;
    void run("ordering", () => setOrderingAction(data.outlet.code, shortCode, lock), lock ? c.pausedDone : c.resumedDone);
  };

  function requestId(kind: ServiceKind) {
    // Same key as the Orders screen, so a retry from either screen is the same request
    const key = `tq_service:${session.key}:${kind}`;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) return saved;
      const id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
      return id;
    } catch {
      return (attempts.current[kind] ??= crypto.randomUUID());
    }
  }

  async function sendService(kind: ServiceKind) {
    if (preview) {
      closeAll();
      return;
    }
    if (busyRef.current || !online) return;
    busyRef.current = true;
    setBusy(kind);
    setNotice(null);
    try {
      const result = await serviceRequestAction(data.outlet.code, shortCode, kind, requestId(kind));
      if (!result.ok) {
        if (result.error === "gone") {
          router.replace(tablePath);
          return;
        }
        setNotice({
          text: result.error === "host_only" ? s6.hostOnly(session.hostName) : result.error === "blocked" ? s6.billBody : s6.failed,
          error: true,
        });
      } else {
        try {
          sessionStorage.removeItem(`tq_service:${session.key}:${kind}`);
        } catch {
          // Private storage unavailable
        }
        delete attempts.current[kind];
        setNotice({ text: kind === "request_bill" ? `${s6.billTitle}. ${s6.billBody}` : `${s6.service[kind]} · ${s6.waiterNotifiedDetail}` });
      }
      await refresh();
    } catch {
      setNotice({ text: s6.failed, error: true });
    } finally {
      busyRef.current = false;
      setBusy(null);
      setConfirm(null);
    }
  }

  // The latest request that is still worth a line under the buttons
  const latest = data.requests
    .filter((r) => r.requestedAt !== null && (r.status === "open" || clock - (r.requestedAt ?? 0) < 10 * 60_000))
    .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || (b.requestedAt ?? 0) - (a.requestedAt ?? 0))[0];
  const minutesAgo = latest?.requestedAt ? Math.max(0, Math.floor((clock - latest.requestedAt) / 60_000)) : 0;

  return (
    <div
      lang={lang}
      style={brandStyle(deriveBrandTokens(data.outlet.accentColor)) as CSSProperties}
      className={`relative flex flex-1 flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}
    >
      <header className="flex items-center gap-3 pt-4">
        <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-section font-bold break-words text-ink">{data.outlet.name}</p>
          <p className="text-caption text-muted">{c.tableLine(data.table.code, session.people)}</p>
        </div>
        <LanguageToggle lang={lang} label={c.language} preview={!!preview} />
      </header>

      <main className="pb-6">
        <h1 className="mt-5 font-display text-title font-bold text-ink">{c.title}</h1>
        <p className="mt-1 text-caption text-muted">{c.helper}</p>

        {!online && <Banner icon={WifiOff01Icon} tone="offline" title={c.offline} body={c.offlineBody} />}
        {billRequested ? (
          <Banner icon={Invoice01Icon} tone="bill" title={s6.billTitle} by={c.billBy(session.hostName, session.hostIsMe)} body={s6.billBody} />
        ) : session.orderingLocked ? (
          <Banner icon={PauseIcon} tone="paused" title={c.pausedTitle} by={c.pausedBy(session.hostName, session.hostIsMe)} body={c.pausedBody} />
        ) : null}

        {(failed || preview?.failed) && (
          <div role="alert" className="mt-4 rounded-guest border border-line bg-surface p-4 text-body">
            <p>{c.refreshFailed}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={!online}
              className={`mt-1 inline-flex min-h-11 items-center font-semibold text-brand-strong underline underline-offset-4 ${focus}`}
            >
              {c.retry}
            </button>
          </div>
        )}

        {notice && (
          <div
            role={notice.error ? "alert" : "status"}
            className={`mt-4 flex animate-fade items-start gap-2.5 rounded-guest border p-3.5 pr-1.5 text-body ${
              notice.error
                ? "border-danger/25 bg-[var(--state-seated-soft)] text-danger"
                : "border-success/25 bg-[var(--state-available-soft)] text-[var(--state-available-text)]"
            }`}
          >
            <HugeiconsIcon icon={notice.error ? AlertCircleIcon : CheckmarkCircle02Icon} size={20} className="mt-px shrink-0" aria-hidden />
            <p className="min-w-0 flex-1 pt-px font-semibold">{notice.text}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label={c.close}
              className={`-my-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-ink/5 ${focus}`}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
            </button>
          </div>
        )}

        {/* At this table */}
        <section aria-labelledby="g7-people" className="mt-6">
          <h2 id="g7-people" className="font-display text-section font-bold text-ink">
            {c.atTable(active.length)}
          </h2>
          <ul className="mt-1.5">
            {active.map((p) => (
              <PersonRow key={p.id} person={p} c={c}>
                {canManage && !p.isMe && (
                  <button
                    type="button"
                    onClick={() => setPersonSheet(p)}
                    aria-label={c.moreFor(fullName(p))}
                    aria-haspopup="dialog"
                    className={`-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink ${focus}`}
                  >
                    <HugeiconsIcon icon={MoreHorizontalIcon} size={20} aria-hidden />
                  </button>
                )}
              </PersonRow>
            ))}
          </ul>
          {paid.length > 0 && (
            <div className="mt-2 border-t border-line pt-3">
              <h3 className="text-caption font-semibold text-muted">{c.paidAndLeftCount(paid.length)}</h3>
              <ul className="mt-1">
                {paid.map((p) => (
                  <PersonRow key={p.id} person={p} c={c} muted>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--state-paid-soft)] px-2 py-0.5 text-label font-semibold text-[var(--state-paid-text)]">
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} aria-hidden />
                      {c.paidAndLeft}
                    </span>
                  </PersonRow>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Invite someone */}
        <button
          type="button"
          onClick={() => setSheet("invite")}
          aria-haspopup="dialog"
          className={`mt-4 flex min-h-16 w-full items-center gap-3 rounded-cta bg-brand px-4 py-3 text-left text-brand-on transition-colors duration-150 ease-natural hover:bg-brand-hover active:bg-brand-pressed ${focus}`}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-input bg-brand-on/15" aria-hidden>
            <HugeiconsIcon icon={QrCodeIcon} size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-button font-semibold">{c.invite}</span>
            <span className="block text-caption opacity-90">{data.invite.joinCode ? c.inviteHelpCode : c.inviteHelpQr}</span>
          </span>
          <HugeiconsIcon icon={ArrowRight01Icon} size={20} className="shrink-0" aria-hidden />
        </button>

        {/* Ordered so far */}
        <OrderedSoFar data={data} c={c} tablePath={tablePath} preview={!!preview} />

        {/* Host controls, or who the host is */}
        {session.isHost ? (
          <section aria-labelledby="g7-host" className="mt-6">
            <h2 id="g7-host" className="font-display text-section font-bold text-ink">
              {c.hostControls}
            </h2>
            {billRequested ? (
              <p className="mt-2 text-body text-muted">{c.settlingNoChanges}</p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2 min-[380px]:items-start">
                  <div>
                    <button
                      type="button"
                      onClick={toggleOrdering}
                      disabled={!online || !!busy}
                      aria-busy={busy === "ordering" || undefined}
                      className={`${button} w-full px-3 ${session.orderingLocked ? "bg-success text-white hover:bg-success/90" : "bg-brand-strong text-brand-on hover:bg-brand-pressed"}`}
                    >
                      <HugeiconsIcon
                        icon={busy === "ordering" ? Loading03Icon : session.orderingLocked ? PlayIcon : PauseIcon}
                        size={18}
                        className={busy === "ordering" ? "animate-spin" : ""}
                        aria-hidden
                      />
                      {session.orderingLocked ? c.resume : c.pause}
                    </button>
                    <p className="mt-1.5 text-caption text-muted">{session.orderingLocked ? c.resumeHelp : c.pauseHelp}</p>
                  </div>
                  <button type="button" onClick={() => setSheet("manage")} aria-haspopup="dialog" className={`${outline} px-3`}>
                    <HugeiconsIcon icon={UserGroupIcon} size={18} aria-hidden />
                    {c.managePeople}
                  </button>
                </div>
              </>
            )}
          </section>
        ) : (
          <div className="mt-6 flex items-start gap-3 rounded-guest border border-[var(--state-cleaning)]/15 bg-[var(--state-cleaning-soft)] p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--state-held-soft)] text-[var(--state-held-text)]" aria-hidden>
              <HugeiconsIcon icon={CrownIcon} size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-body font-semibold break-words text-ink">{c.hostIs(session.hostName)}</p>
              <p className="mt-0.5 text-caption text-muted">{c.hostInfo}</p>
            </div>
          </div>
        )}

        {/* Need something? Same requests, cooldowns and bill rules as Orders (G6) */}
        <section aria-labelledby="g7-service" className="mt-7">
          <h2 id="g7-service" className="font-display text-section font-bold text-ink">
            {c.needs}
          </h2>
          <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(max(52px,4.75em),1fr))] gap-1.5 text-label">
            {data.requests.map((r) => {
              const isBill = r.kind === "request_bill";
              const cooling = Math.max(0, Math.ceil((r.cooldownUntil - clock) / 1000));
              const pending = r.status === "open";
              const done = r.status === "done";
              const disabled = !online || !!busy || cooling > 0 || pending || (isBill && (!session.isHost || billRequested));
              const label = isBill && billRequested ? s6.billTitle : s6.service[r.kind];
              const settled = isBill && billRequested;
              // Short words on the tile; the full sentence for screen readers
              const state = busy === r.kind || settled ? null : pending ? c.notified : cooling > 0 ? c.waitFor(cooling) : done ? c.done : null;
              const spoken = settled ? s6.billTitle : pending ? s6.waiterNotified : cooling > 0 ? s6.cooldown(cooling) : done ? s6.done : null;
              return (
                <li key={r.kind} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => (isBill ? setConfirm({ kind: "bill" }) : void sendService(r.kind))}
                    disabled={disabled}
                    aria-busy={busy === r.kind || undefined}
                    aria-label={spoken ? `${s6.service[r.kind]}, ${spoken}` : s6.service[r.kind]}
                    className={`group flex min-h-[92px] w-full flex-col items-center gap-1.5 rounded-guest px-0.5 py-2 text-center disabled:cursor-not-allowed ${focus}`}
                  >
                    <span
                      className={`relative grid size-11 place-items-center rounded-card border transition-colors ${
                        pending || cooling > 0 || (isBill && billRequested)
                          ? "border-line bg-[#F5F2EC] text-muted"
                          : isBill && !session.isHost
                            ? "border-line bg-[#F5F2EC] text-muted"
                            : "border-brand-border bg-brand-soft text-brand-strong group-hover:border-brand"
                      }`}
                    >
                      <HugeiconsIcon
                        icon={busy === r.kind ? Loading03Icon : serviceIcons[r.kind]}
                        size={22}
                        className={busy === r.kind ? "animate-spin" : ""}
                        aria-hidden
                      />
                      {(pending || done) && !settled && (
                        <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-surface text-success ring-1 ring-line">
                          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className={`font-medium break-words hyphens-auto ${disabled ? "text-muted" : "text-ink"}`}>{label}</span>
                    {state && (
                      <span
                        className={`inline-flex items-center gap-0.5 font-semibold tabular ${pending || (done && !cooling) ? "text-success" : "text-muted"}`}
                      >
                        {cooling > 0 && !pending && <HugeiconsIcon icon={Clock01Icon} size={11} aria-hidden />}
                        {state}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {latest && (
            <p role="status" className="mt-2 flex items-start gap-1.5 text-caption text-muted">
              <HugeiconsIcon
                icon={latest.status === "done" ? CheckmarkCircle02Icon : BellRingIcon}
                size={14}
                className={`mt-px shrink-0 ${latest.status === "done" ? "text-success" : ""}`}
                aria-hidden
              />
              <span>
                <span className="font-semibold text-ink">{s6.service[latest.kind]}</span> ·{" "}
                {latest.status === "done" ? s6.done : minutesAgo ? c.notifiedAgo(minutesAgo) : c.notifiedNow}
              </span>
            </p>
          )}
          {!session.isHost && !billRequested && <p className="mt-2 text-caption text-muted">{s6.hostOnly(session.hostName)}</p>}
        </section>
      </main>

      <DiningNav tablePath={tablePath} active="table" lang={lang} inProgress={data.inProgress} preview={!!preview} />

      {sheet === "invite" && <InviteSheet data={data} invite={invite} c={c} onClose={() => setSheet(null)} />}

      {sheet === "manage" && (
        <Sheet titleId="g7-manage" title={c.manageTitle} c={c} busy={!!busy} onClose={() => setSheet(null)}>
          {others.length ? (
            <ul className="mt-2 divide-y divide-line/70">
              {others.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <Avatar person={p} />
                  <span className="min-w-0 flex-1 text-body font-semibold break-words">{fullName(p)}</span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirm({ kind: "pass", person: p })}
                      disabled={!online}
                      className={`${outline} min-h-11 px-3 text-caption`}
                    >
                      {c.makeHost}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm({ kind: "remove", person: p })}
                      disabled={!online}
                      className={`${button} min-h-11 border border-danger/40 bg-surface px-3 text-caption text-danger hover:bg-[var(--state-seated-soft)]`}
                    >
                      {c.remove}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-body text-muted">{c.manageEmpty}</p>
          )}
          <button type="button" onClick={() => setSheet(null)} className={`${outline} mt-4 w-full`}>
            {c.cancel}
          </button>
        </Sheet>
      )}

      {personSheet && !confirm && (
        <Sheet
          titleId="g7-person"
          title={fullName(personSheet)}
          c={c}
          busy={!!busy}
          onClose={() => setPersonSheet(null)}
          lead={<Avatar person={personSheet} />}
        >
          <div className="mt-4 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => setConfirm({ kind: "pass", person: personSheet })}
              disabled={!online}
              className={`${outline} w-full justify-start`}
            >
              <HugeiconsIcon icon={UserSwitchIcon} size={20} aria-hidden />
              {c.makeHost}
            </button>
            <button
              type="button"
              onClick={() => setConfirm({ kind: "remove", person: personSheet })}
              disabled={!online}
              className={`${button} w-full justify-start border border-danger/40 bg-surface text-danger hover:bg-[var(--state-seated-soft)]`}
            >
              <HugeiconsIcon icon={UserRemove01Icon} size={20} aria-hidden />
              {c.removeFromTable}
            </button>
            <button type="button" onClick={() => setPersonSheet(null)} className={`${outline} w-full`}>
              {c.cancel}
            </button>
          </div>
        </Sheet>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "bill" ? s6.billConfirm : confirm.kind === "remove" ? c.removeTitle : c.passTitle(shortName(confirm.person))}
          body={confirm.kind === "bill" ? s6.billConfirmBody : confirm.kind === "remove" ? c.removeBody : c.passBody}
          person={confirm.kind === "bill" ? null : confirm.person}
          personName={confirm.kind === "bill" ? "" : fullName(confirm.person)}
          confirmText={confirm.kind === "bill" ? s6.service.request_bill : confirm.kind === "remove" ? c.remove : c.makeHost}
          keepText={confirm.kind === "bill" ? s6.keepOrdering : c.cancel}
          danger={confirm.kind === "remove"}
          busy={!!busy}
          disabled={!online}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
          onConfirm={() => {
            if (confirm.kind === "bill") return void sendService("request_bill");
            const { person } = confirm;
            if (confirm.kind === "remove")
              void run(`remove:${person.id}`, () => removePersonAction(data.outlet.code, shortCode, person.id), c.removed(shortName(person)));
            else void run(`pass:${person.id}`, () => passHostAction(data.outlet.code, shortCode, person.id), c.passed(shortName(person)));
          }}
        />
      )}
    </div>
  );
}

function PersonRow({ person, c, muted, children }: { person: Person; c: G7Copy; muted?: boolean; children?: ReactNode }) {
  return (
    <li className={`flex min-h-14 items-center gap-3 py-1.5 ${muted ? "opacity-75" : ""}`}>
      <Avatar person={person} muted={muted} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`min-w-0 text-body font-semibold break-words ${muted ? "text-muted" : "text-ink"}`}>
          {person.isMe ? (
            person.name ? (
              <>
                {person.name} <span className="font-normal text-muted">{c.youSuffix}</span>
              </>
            ) : (
              c.you
            )
          ) : (
            (person.name ?? <span className="font-normal">{c.anotherGuest}</span>)
          )}
        </span>
        {person.isHost && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--state-held-soft)] px-2 py-0.5 text-label font-semibold text-[var(--state-held-text)]">
            <HugeiconsIcon icon={CrownIcon} size={12} aria-hidden />
            {c.host}
          </span>
        )}
      </div>
      {children}
    </li>
  );
}

function Avatar({ person, muted }: { person: Person; muted?: boolean }) {
  const text = initials(person.name);
  const tone =
    muted || !text
      ? "bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]"
      : AVATAR_TONES[[...person.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full font-display text-body font-bold ${tone}`}>
      {text ?? <HugeiconsIcon icon={UserIcon} size={18} />}
    </span>
  );
}

function OrderedSoFar({ data, c, tablePath, preview }: { data: TableScreenData; c: G7Copy; tablePath: string; preview: boolean }) {
  const { ordered } = data;
  const empty = ordered.rounds === 0;
  const canOrder = data.session.status === "open" && !data.session.orderingLocked;
  if (empty && !canOrder) {
    return (
      <div className="mt-3 rounded-guest border border-line bg-surface px-4 py-3.5">
        <p className="text-body font-semibold text-ink">{c.orderedSoFar}</p>
        <p className="mt-0.5 text-caption text-muted">{c.nothingOrdered}</p>
      </div>
    );
  }
  return (
    <Link
      href={preview ? "#" : `${tablePath}/${empty ? "menu" : "orders"}`}
      prefetch={false}
      onNavigate={(e) => {
        if (preview) e.preventDefault();
      }}
      className={`mt-3 flex min-h-16 items-center gap-3 rounded-guest border border-line bg-surface px-4 py-3 transition-colors hover:border-ink/30 ${focus}`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-body font-semibold text-ink">{c.orderedSoFar}</span>
          {!empty && <span className="font-display text-section font-bold text-ink tabular">{formatRupees(ordered.totalPaise)}</span>}
        </span>
        <span className="mt-0.5 block text-caption text-muted">
          {empty ? (
            <>
              {c.nothingOrdered} · <span className="font-semibold text-brand-strong">{c.browseMenu}</span>
            </>
          ) : (
            <>
              {c.rounds(ordered.rounds)} <span aria-hidden>·</span> {ordered.inKitchen ? c.inKitchen(ordered.inKitchen) : c.allServed}
            </>
          )}
        </span>
      </span>
      <HugeiconsIcon icon={ArrowRight01Icon} size={18} className="shrink-0 text-muted" aria-hidden />
      <span className="sr-only">{empty ? c.browseMenu : c.seeOrders}</span>
    </Link>
  );
}

const BANNER_TONE = {
  paused: "border-[var(--state-held)]/25 bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  bill: "border-[var(--state-bill)]/20 bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]",
  offline: "border-line bg-surface text-ink",
} as const;

function Banner({ icon, tone, title, by, body }: { icon: IconSvgElement; tone: keyof typeof BANNER_TONE; title: string; by?: string; body: string }) {
  return (
    <div role="status" className={`mt-4 flex items-start gap-3 rounded-guest border px-4 py-3 ${BANNER_TONE[tone]}`}>
      <HugeiconsIcon icon={icon} size={20} className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-body font-semibold">{title}</p>
        {by && <p className="text-caption font-semibold">{by}</p>}
        <p className="mt-0.5 text-caption text-ink/75">{body}</p>
      </div>
    </div>
  );
}

/** Bottom sheet on the native dialog: focus is trapped, Escape and the backdrop close it */
function Sheet({
  titleId,
  title,
  c,
  busy,
  onClose,
  lead,
  children,
}: {
  titleId: string;
  title: string;
  c: G7Copy;
  busy: boolean;
  onClose: () => void;
  lead?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
        // Start reading at the title rather than on the close button
        heading.current?.focus();
      } catch {
        // Already open in another layer
      }
    }
    return () => {
      try {
        dialog?.close();
      } catch {
        // Already closed
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 mx-auto max-h-[92dvh] w-full max-w-[480px] animate-sheet overflow-y-auto rounded-t-sheet border-t border-line bg-paper px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-ink shadow-[var(--shadow-sheet)] backdrop:bg-ink/40"
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden />
      <div className="flex items-start gap-3">
        {lead}
        <h2 ref={heading} tabIndex={-1} id={titleId} className="min-w-0 flex-1 pt-2 outline-none font-display text-title font-bold break-words">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={c.close}
          className={`-mr-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-ink/5 ${focus}`}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function InviteSheet({ data, invite, c, onClose }: { data: TableScreenData; invite: InviteLink; c: G7Copy; onClose: () => void }) {
  const code = data.table.code;
  const joinCode = data.invite.joinCode;
  const [copied, setCopied] = useState(false);
  const body = joinCode ? c.inviteBodyCode : data.invite.mode === "verified" ? c.inviteBodyVerified : c.inviteBodyOpen;

  // Native sharing where the phone has it, otherwise copy the link. Only the table's address.
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: data.outlet.name, text: c.shareText(data.outlet.name, code), url: invite.url });
        return;
      }
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      // Share sheet dismissed, or clipboard blocked: the QR and the link text are still there
    }
  }

  return (
    <Sheet titleId="g7-invite" title={c.inviteTitle(code)} c={c} busy={false} onClose={onClose}>
      <p className="mt-1 text-body text-muted">{body}</p>

      <figure className="mt-4 flex flex-col items-center rounded-guest bg-brand-soft px-4 py-5 text-center">
        <svg
          role="img"
          aria-label={c.qrLabel(code)}
          viewBox={`0 0 ${invite.qrBox} ${invite.qrBox}`}
          shapeRendering="crispEdges"
          className="size-48 rounded-card bg-white shadow-[var(--shadow-dropdown)]"
        >
          <rect width={invite.qrBox} height={invite.qrBox} fill="#fff" />
          <path d={invite.qrPath} fill="#1F2937" />
        </svg>
        <figcaption className="mt-3">
          <span className="block text-body font-semibold text-ink">{c.scanToJoin(code)}</span>
          <span className="mt-0.5 block text-caption text-muted">
            {data.outlet.name}
            {data.outlet.city ? `, ${data.outlet.city}` : ""}
          </span>
          <span className="mt-1.5 block text-label break-all text-muted select-all">{invite.display}</span>
        </figcaption>
      </figure>

      {joinCode && (
        <>
          <div className="my-3 flex items-center gap-3 text-caption font-semibold text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            {c.or}
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="rounded-guest bg-brand-soft px-4 py-4 text-center">
            <p className="text-caption font-semibold text-brand-strong">{c.joinCode}</p>
            <p role="img" aria-label={c.joinCodeSpoken(joinCode)} className="mt-2 flex justify-center gap-2">
              {joinCode.split("").map((d, i) => (
                <span
                  key={i}
                  className="grid h-14 w-12 place-items-center rounded-input border border-line bg-surface font-display text-display font-bold text-ink tabular"
                >
                  {d}
                </span>
              ))}
            </p>
            <p className="mt-2.5 text-caption text-muted">{c.joinCodeHelp}</p>
          </div>
        </>
      )}

      <button type="button" onClick={() => void share()} className={`${outline} mt-4 w-full`}>
        <HugeiconsIcon icon={Share08Icon} size={18} aria-hidden />
        {c.share}
      </button>
      {copied && (
        <p role="status" className="mt-2 text-center text-caption font-semibold text-success">
          {c.copied}
        </p>
      )}

      {!joinCode && (
        <div className="mt-4 flex items-start gap-2.5 rounded-guest bg-[var(--state-cleaning-soft)] p-3.5 text-caption text-[var(--state-cleaning-text)]">
          <HugeiconsIcon icon={InformationCircleIcon} size={18} className="shrink-0" aria-hidden />
          <p>
            {data.invite.mode === "verified" ? c.verifiedNote : c.openModeNote}
            <br />
            {c.openModeNoCode}
          </p>
        </div>
      )}
    </Sheet>
  );
}

function ConfirmDialog({
  title,
  body,
  person,
  personName,
  confirmText,
  keepText,
  danger,
  busy,
  disabled,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  person: Person | null;
  personName: string;
  confirmText: string;
  keepText: string;
  danger: boolean;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Already open in another layer
      }
    }
    return () => {
      try {
        dialog?.close();
      } catch {
        // Already closed
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="g7-confirm-title"
      aria-describedby="g7-confirm-body"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 mx-auto w-full max-w-[480px] animate-sheet rounded-t-sheet border-t border-line bg-paper px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-center text-ink shadow-[var(--shadow-sheet)] backdrop:bg-ink/40"
    >
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" aria-hidden />
      <h2 id="g7-confirm-title" className="font-display text-title font-bold break-words">
        {title}
      </h2>
      {person && (
        <p className="mt-3 flex items-center justify-center gap-2.5">
          <Avatar person={person} />
          <span className="text-body font-semibold break-words">{personName}</span>
        </p>
      )}
      <p id="g7-confirm-body" className="mt-3 text-body text-muted">
        {body}
      </p>
      <div className="mt-6 grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2">
        <button type="button" autoFocus onClick={onClose} disabled={busy} className={outline}>
          {keepText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || disabled}
          aria-busy={busy || undefined}
          className={`${button} ${danger ? "bg-danger text-white hover:bg-danger/90" : "bg-brand text-brand-on hover:bg-brand-hover"}`}
        >
          {busy && <HugeiconsIcon icon={Loading03Icon} size={18} className="animate-spin" aria-hidden />}
          {confirmText}
        </button>
      </div>
    </dialog>
  );
}
