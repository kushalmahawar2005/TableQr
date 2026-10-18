"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cancel01Icon, PlusSignIcon, PrinterIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ROOM_REQUEST_LABEL, ROOM_STATUS_LABEL, type RoomStatus } from "@/domain/rooms";
import type { RoomsData, StayHistory } from "@/server/staff/rooms";
import { checkInAction, checkOutAction, foodTabAction, removeRoomAction, requestDoneAction, roomStatusAction, roomsAction, saveRoomAction } from "../actions";

// Rooms: the front desk's screen. Who is in which room, check-in and check-out, room food (taken
// on Billing like any table) and what guests asked for from the room QR. Refreshes on its own.

type Room = RoomsData["rooms"][number];
type Panel = { kind: "room"; room: Room | null } | { kind: "checkin"; room: Room } | { kind: "checkout"; room: Room } | null;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const card = "rounded-2xl border border-line bg-surface";
const field = `h-11 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink placeholder:text-muted ${focus}`;
const primary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-button font-semibold text-paper disabled:opacity-50 ${focus}`;
const quiet = `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-caption font-semibold text-ink hover:bg-ink/[0.05] disabled:opacity-50 ${focus}`;
const rs = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const day = (at: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(at);
const when = (at: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(at);
const ago = (at: number) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
};
const TONE: Record<RoomStatus, string> = {
  vacant: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
  occupied: "bg-brand/10 text-brand",
  cleaning: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  blocked: "bg-ink/[0.08] text-muted",
};
const tomorrow = () => new Date(Date.now() + 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 outline-none sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-section font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`grid size-9 place-items-center rounded-lg text-muted hover:bg-ink/5 ${focus}`}>
            <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function RoomsScreen({ initial, history: initialHistory }: { initial: RoomsData; history: StayHistory }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [history, setHistory] = useState(initialHistory);
  const [tab, setTab] = useState<"rooms" | "history">("rooms");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const r = await roomsAction();
    if (r.ok) {
      setData(r.data.rooms);
      setHistory(r.data.history);
    }
  }, []);
  // New room requests and food come in from guests' phones; check every 20 seconds
  useEffect(() => {
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const run = async (task: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, inPanel = true) => {
    setBusy(true);
    setError(null);
    const r = await task();
    setBusy(false);
    if (!r.ok) return inPanel && panel ? setError(r.error) : setNotice({ ok: false, text: r.error });
    setPanel(null);
    setNotice({ ok: true, text: done });
    await reload();
  };
  const close = () => {
    setPanel(null);
    setError(null);
  };
  const addFood = async (room: Room) => {
    setBusy(true);
    const r = await foodTabAction(room.id);
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.error });
    router.push(`/console/billing?session=${encodeURIComponent(r.data.sessionId)}`);
  };

  const rooms = data.rooms;
  const count = (st: RoomStatus) => rooms.filter((r) => r.status === st).length;
  const requests = rooms.flatMap((r) => r.requests.map((q) => ({ ...q, room: r.number }))).sort((a, b) => a.createdAt - b.createdAt);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold text-ink">Rooms</h1>
          <p className="mt-1 text-body text-muted">
            {count("occupied")} of {rooms.length} rooms have guests · {count("vacant")} ready · {count("cleaning")} cleaning
            {data.maxRooms !== null && data.canManage ? ` · plan allows ${data.maxRooms}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {rooms.length > 0 && (
            <Link href="/console/rooms/qr-sheet" className={`${quiet} min-h-11 px-4`}>
              <HugeiconsIcon icon={PrinterIcon} size={16} aria-hidden />
              Print room QR codes
            </Link>
          )}
          {data.canManage && (
            <button type="button" className={primary} onClick={() => setPanel({ kind: "room", room: null })}>
              <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden />
              Add room
            </button>
          )}
        </div>
      </header>

      {notice && (
        <p role="status" className={`mt-4 rounded-xl px-4 py-2.5 text-body ${notice.ok ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-danger/10 text-danger"}`}>
          {notice.text}
        </p>
      )}

      {requests.length > 0 && (
        <section aria-label="Room requests" className="mt-4 rounded-2xl border border-brand/30 bg-brand/[0.05] p-4">
          <h2 className="font-display text-section font-bold text-ink">Guests are asking ({requests.length})</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {requests.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">Room {q.room} · {ROOM_REQUEST_LABEL[q.kind].en}</p>
                  <p className="truncate text-caption text-muted">{q.note ? `“${q.note}” · ` : ""}{ago(q.createdAt)}</p>
                </div>
                <button type="button" className={quiet} disabled={busy} onClick={() => void run(() => requestDoneAction(q.id), `Room ${q.room}: done.`, false)}>Done</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div role="tablist" aria-label="Rooms" className="mt-5 inline-flex rounded-xl border border-line bg-surface p-1">
        {([["rooms", "Rooms"], ["history", "Past stays"]] as const).map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-9 rounded-lg px-4 text-body font-semibold ${focus} ${tab === k ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "rooms" &&
        (rooms.length === 0 ? (
          <section className={`${card} mt-4 px-6 py-12 text-center`}>
            <p className="font-display text-section font-bold text-ink">No rooms yet</p>
            <p className="mx-auto mt-1 max-w-md text-body text-muted">
              {data.canManage ? "Add your rooms, then print their QR codes and put one in each room. Guests scan it to order food and ask for towels or cleaning." : "Ask the owner or a manager to add the rooms."}
            </p>
            {data.canManage && <button type="button" className={`${primary} mt-4`} onClick={() => setPanel({ kind: "room", room: null })}>Add room</button>}
          </section>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rooms.map((room) => (
              <li key={room.id} className={`${card} flex flex-col p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {data.canManage ? (
                      <button type="button" onClick={() => setPanel({ kind: "room", room })} className={`font-display text-title font-bold text-ink hover:underline ${focus}`}>Room {room.number}</button>
                    ) : (
                      <p className="font-display text-title font-bold text-ink">Room {room.number}</p>
                    )}
                    <p className="text-caption text-muted">{[room.roomType, room.floorLabel].filter(Boolean).join(" · ") || " "}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-caption font-semibold ${TONE[room.status]}`}>{ROOM_STATUS_LABEL[room.status].en}</span>
                </div>

                {room.stay ? (
                  <div className="mt-3 rounded-xl bg-ink/[0.03] px-3 py-2.5 text-body">
                    <p className="font-semibold text-ink">{room.stay.guestName} <span className="font-normal text-muted">· {room.stay.guests} {room.stay.guests === 1 ? "guest" : "guests"}</span></p>
                    <p className="text-caption text-muted">
                      In {day(room.stay.checkInAt)}{room.stay.expectedCheckOutAt ? ` · out ${day(room.stay.expectedCheckOutAt)}` : ""}{room.stay.guestPhone ? ` · ${room.stay.guestPhone.replace(/^\+91/, "")}` : ""}
                    </p>
                    <p className="mt-1 text-caption">
                      {room.stay.food.unpaidPaise > 0 ? (
                        <span className="font-semibold text-danger">Food {rs(room.stay.food.unpaidPaise)} not paid ({room.stay.food.items} {room.stay.food.items === 1 ? "item" : "items"}, before tax)</span>
                      ) : (
                        <span className="text-muted">No unpaid food{room.stay.food.paidPaise ? ` · ${rs(room.stay.food.paidPaise)} paid` : ""}</span>
                      )}
                      <span className="text-muted"> · {room.stay.foodPay === "at_checkout" ? "pay at check-out" : "pay per order"}</span>
                    </p>
                    {room.requests.length > 0 && <p className="mt-1 text-caption font-semibold text-brand">{room.requests.length} open {room.requests.length === 1 ? "request" : "requests"}</p>}
                  </div>
                ) : (
                  <p className="mt-3 text-caption text-muted">{room.hasQr ? "Guests scan the room QR after check-in." : "No QR yet."}</p>
                )}

                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                  {room.status === "occupied" && room.stay ? (
                    <>
                      {data.canBill && <button type="button" className={quiet} disabled={busy} onClick={() => void addFood(room)}>Add food</button>}
                      {data.canBill && room.stay.food.sessionId && room.stay.food.unpaidPaise > 0 && (
                        <Link href={`/console/billing?session=${encodeURIComponent(room.stay.food.sessionId)}`} className={quiet}>Take payment</Link>
                      )}
                      <button type="button" className={quiet} disabled={busy} onClick={() => setPanel({ kind: "checkout", room })}>Check out</button>
                    </>
                  ) : room.status === "vacant" ? (
                    <button type="button" className={`${quiet} border-ink bg-ink text-paper hover:bg-ink/90`} disabled={busy} onClick={() => setPanel({ kind: "checkin", room })}>Check in</button>
                  ) : room.status === "cleaning" ? (
                    <button type="button" className={quiet} disabled={busy} onClick={() => void run(() => roomStatusAction(room.id, "vacant"), `Room ${room.number} is ready.`, false)}>Mark ready</button>
                  ) : null}
                  {data.canManage && room.status === "vacant" && (
                    <button type="button" className={quiet} disabled={busy} onClick={() => void run(() => roomStatusAction(room.id, "blocked"), `Room ${room.number} is out of service.`, false)}>Out of service</button>
                  )}
                  {data.canManage && room.status === "blocked" && (
                    <button type="button" className={quiet} disabled={busy} onClick={() => void run(() => roomStatusAction(room.id, "vacant"), `Room ${room.number} is back in service.`, false)}>Back in service</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}

      {tab === "history" && (
        <section className={`${card} mt-4 overflow-hidden`} aria-label="Past stays">
          {history.length === 0 ? (
            <p className="px-5 py-10 text-center text-body text-muted">No past stays yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-body">
                <thead>
                  <tr className="text-caption text-muted">
                    <th className="px-5 py-3 font-medium">Room</th>
                    <th className="px-3 py-3 font-medium">Guest</th>
                    <th className="px-3 py-3 font-medium">Check-in</th>
                    <th className="px-3 py-3 font-medium">Check-out</th>
                    <th className="px-5 py-3 text-right font-medium">Room food paid</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t border-line">
                      <td className="px-5 py-2.5 font-semibold text-ink">{h.number.startsWith("x") ? "Removed room" : h.number}</td>
                      <td className="px-3 py-2.5 text-ink">{h.guestName}<span className="block text-caption text-muted">{[h.guestPhone?.replace(/^\+91/, ""), `${h.guests} ${h.guests === 1 ? "guest" : "guests"}`].filter(Boolean).join(" · ")}</span></td>
                      <td className="px-3 py-2.5 text-muted">{when(h.checkInAt)}</td>
                      <td className="px-3 py-2.5 text-muted">{h.checkOutAt ? when(h.checkOutAt) : "—"}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-ink">{rs(h.foodPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {panel?.kind === "room" && (
        <Sheet title={panel.room ? `Edit Room ${panel.room.number}` : "Add room"} onClose={close}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() => saveRoomAction({ id: panel.room?.id ?? null, number: String(f.get("number")), roomType: String(f.get("roomType")), floorLabel: String(f.get("floorLabel")) }), panel.room ? "Saved." : "Room added with its QR code.");
            }}
          >
            <label className="grid gap-1 text-caption font-semibold text-muted">Room number<input name="number" required maxLength={7} defaultValue={panel.room?.number} placeholder="e.g. 204" autoFocus className={field} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-caption font-semibold text-muted">Type<input name="roomType" maxLength={40} defaultValue={panel.room?.roomType ?? ""} placeholder="e.g. Deluxe" className={field} /></label>
              <label className="grid gap-1 text-caption font-semibold text-muted">Floor<input name="floorLabel" maxLength={40} defaultValue={panel.room?.floorLabel ?? ""} placeholder="e.g. 2nd floor" className={field} /></label>
            </div>
            {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : panel.room ? "Save" : "Add room"}</button>
            {panel.room && panel.room.status !== "occupied" && (
              <button type="button" disabled={busy} onClick={() => void run(() => removeRoomAction(panel.room!.id), `Room ${panel.room!.number} removed. Its QR code no longer works.`)} className={`min-h-10 text-caption font-semibold text-danger ${focus}`}>Remove room</button>
            )}
          </form>
        </Sheet>
      )}

      {panel?.kind === "checkin" && (
        <Sheet title={`Check in: Room ${panel.room.number}`} onClose={close}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () => checkInAction(panel.room.id, { guestName: String(f.get("guestName")), guestPhone: String(f.get("guestPhone")), guests: String(f.get("guests")), foodPay: String(f.get("foodPay")), checkOutDate: String(f.get("checkOutDate") ?? ""), note: String(f.get("note") ?? "") }),
                `Checked in to Room ${panel.room.number}. The room QR now works.`,
              );
            }}
          >
            <label className="grid gap-1 text-caption font-semibold text-muted">Guest name<input name="guestName" required maxLength={80} autoFocus className={field} /></label>
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
              <label className="grid gap-1 text-caption font-semibold text-muted">Mobile<input name="guestPhone" inputMode="tel" maxLength={14} placeholder="Optional" className={field} /></label>
              <label className="grid gap-1 text-caption font-semibold text-muted">Guests<input name="guests" type="number" min={1} max={20} defaultValue={2} className={field} /></label>
            </div>
            <label className="grid gap-1 text-caption font-semibold text-muted">Check-out date<input name="checkOutDate" type="date" defaultValue={tomorrow()} className={field} /></label>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-caption font-semibold text-muted">Room food</legend>
              <label className="flex items-center gap-2 text-body text-ink"><input type="radio" name="foodPay" value="at_checkout" defaultChecked className="size-4 accent-[var(--brand-main)]" />Add to the room, pay at check-out</label>
              <label className="flex items-center gap-2 text-body text-ink"><input type="radio" name="foodPay" value="per_order" className="size-4 accent-[var(--brand-main)]" />Pay when the food comes</label>
            </fieldset>
            <label className="grid gap-1 text-caption font-semibold text-muted">Note<input name="note" maxLength={140} placeholder="Optional, e.g. ID checked, advance ₹1000" className={field} /></label>
            {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : "Check in"}</button>
          </form>
        </Sheet>
      )}

      {panel?.kind === "checkout" && panel.room.stay && (
        <Sheet title={`Check out: Room ${panel.room.number}`} onClose={close}>
          <p className="text-body text-ink">{panel.room.stay.guestName} · in since {when(panel.room.stay.checkInAt)}</p>
          {panel.room.stay.food.unpaidPaise > 0 ? (
            <div className="mt-3 rounded-xl border border-danger/30 bg-danger/[0.06] p-3 text-body">
              <p className="font-semibold text-danger">Food of {rs(panel.room.stay.food.unpaidPaise)} (before tax) is not paid.</p>
              <p className="mt-1 text-muted">Take the payment on Billing first, then check out.</p>
              {data.canBill && panel.room.stay.food.sessionId && (
                <Link href={`/console/billing?session=${encodeURIComponent(panel.room.stay.food.sessionId)}`} className={`${primary} mt-3 w-full`}>Take payment</Link>
              )}
            </div>
          ) : (
            <p className="mt-3 text-body text-muted">No food is due. The room goes to Cleaning and its QR stops working until the next check-in.</p>
          )}
          {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
          <button type="button" disabled={busy || panel.room.stay.food.unpaidPaise > 0} onClick={() => void run(() => checkOutAction(panel.room.id), `Room ${panel.room.number} checked out. It is now in Cleaning.`)} className={`${primary} mt-4 w-full`}>
            {busy ? "Saving…" : "Check out"}
          </button>
        </Sheet>
      )}
    </main>
  );
}
