"use client";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { DutyRow, DutyStatus } from "@/server/staff/duty";
import { setDutyAction } from "../../team/actions";
import { EmptyLine, Panel, viewAllClass } from "./dashboard-shared";

const VISIBLE = 6;

/**
 * Compact avatar group (spec §10): initials fallback, duty dot, +N overflow to the team screen,
 * and a popover whose On/Break/Off controls call the existing duty action — with the picked
 * state shown only after the server accepts, an inline error when it does not, and the buttons
 * disabled while the change is in flight.
 */
export function StaffOnDuty({ duty }: { duty: { rows: DutyRow[]; canChange?: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setSelectedId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Riders have their own row below; everyone else is the floor and kitchen team
  const riders = duty.rows.filter((r) => r.roles.includes("rider"));
  const rows = duty.rows.filter((r) => !r.roles.includes("rider"));
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const onDutyCount = rows.filter((r) => r.status === "on").length;
  const onBreakCount = rows.filter((r) => r.status === "break").length;
  const offCount = rows.filter((r) => r.status === "off").length;
  const visibleStaff = rows.slice(0, VISIBLE);
  const overflow = rows.length - VISIBLE;

  const changeStatus = (id: string, status: DutyStatus) => {
    setError(null);
    start(async () => {
      const res = await setDutyAction(id, status).catch(() => null);
      if (!res?.ok) {
        setError("That didn't go through. Try again.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <Panel
        title="Staff on duty"
        action={<Link href="/console/team" className={viewAllClass}><span>Manage</span></Link>}
      >
        <p className="-mt-1 text-xs font-medium text-muted">
          {onDutyCount} on duty · {onBreakCount} break · {offCount} off
        </p>

        {rows.length === 0 ? (
          <EmptyLine>No staff assigned to this outlet.</EmptyLine>
        ) : (
          <div className="mt-2 flex flex-wrap items-start gap-2">
            {visibleStaff.map((staff) => {
              const initials =
                staff.name.trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "S";
              const dotColor = staff.status === "on" ? "bg-emerald-500" : staff.status === "break" ? "bg-amber-500" : "bg-neutral-400";
              return (
                <button
                  key={staff.id}
                  type="button"
                  onClick={() => { setError(null); setSelectedId(selectedId === staff.id ? null : staff.id); }}
                  aria-haspopup="dialog"
                  aria-expanded={selectedId === staff.id}
                  aria-label={`${staff.name}, ${staff.roles[0] || "Staff"}, ${staff.status === "on" ? "on duty" : staff.status === "break" ? "on break" : "off duty"}`}
                  className="group flex min-h-10 w-14 flex-col items-center rounded-input p-1 text-center transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-forest cursor-pointer"
                >
                  <span className="relative">
                    {staff.photoUrl
                      // Staff photos live in the photo bucket, so this stays a plain image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={staff.photoUrl} alt="" className="size-11 rounded-full border border-line object-cover transition-transform group-hover:scale-105" />
                      : <span className="grid size-11 place-items-center rounded-full border border-line bg-neutral-100 font-display text-xs font-bold text-ink transition-transform group-hover:scale-105">{initials}</span>}
                    <span className={`absolute bottom-0 right-0 size-3 rounded-full ring-2 ring-white ${dotColor}`} aria-hidden="true" />
                  </span>
                  <span className="mt-1.5 w-full truncate text-xs font-bold text-ink">{staff.name.split(" ")[0]}</span>
                  <span className="w-full truncate text-[10px] font-medium capitalize text-muted">{staff.roles[0] || "Staff"}</span>
                </button>
              );
            })}

            {rows.length < 3 && (
              <Link
                href="/console/team"
                className="flex w-14 flex-col items-center rounded-input p-1 text-center transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-forest"
                aria-label="Add staff member"
              >
                <span className="grid size-11 place-items-center rounded-full border border-dashed border-line text-muted transition-colors hover:border-forest hover:text-forest">
                  <Plus className="size-4" aria-hidden="true" />
                </span>
                <span className="mt-1.5 text-[11px] font-semibold text-muted">Add</span>
              </Link>
            )}

            {overflow > 0 && (
              <Link
                href="/console/team"
                className="flex w-14 flex-col items-center rounded-input p-1 text-center transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-forest"
                aria-label={`${overflow} more staff on the team screen`}
              >
                <span className="grid size-11 place-items-center rounded-full border border-line bg-neutral-100 text-xs font-bold text-muted">+{overflow}</span>
                <span className="mt-1.5 text-[11px] font-semibold text-muted">More</span>
              </Link>
            )}
          </div>
        )}
        {riders.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted">Riders · {riders.filter((r) => r.status === "on").length} online</p>
              <Link href="/console/orders?view=delivery" className="text-xs font-semibold text-forest hover:underline">Deliveries</Link>
            </div>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              {riders.map((r) => (
                <div key={r.id} className="flex w-14 flex-col items-center p-1 text-center">
                  <span className="relative">
                    {r.photoUrl
                      // Staff photos live in the photo bucket, so this stays a plain image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={r.photoUrl} alt="" className="size-11 rounded-full border border-line object-cover" />
                      : <span className="grid size-11 place-items-center rounded-full border border-line bg-neutral-100 font-display text-xs font-bold text-ink">{r.name.trim().slice(0, 1).toUpperCase()}</span>}
                    <span className={`absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-white ${r.status === "on" ? "bg-emerald-500" : "bg-neutral-400"}`} aria-hidden="true" />
                  </span>
                  <span className="mt-1.5 w-full truncate text-xs font-bold text-ink">{r.name.split(" ")[0]}</span>
                  <span className="w-full truncate text-[10px] font-medium text-muted">{r.status === "on" ? "Online" : "Offline"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {selected && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${selected.name} duty status`}
          className="absolute right-4 top-16 z-50 w-64 rounded-card border border-line bg-surface p-4 shadow-modal"
        >
          <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
            <div>
              <p className="text-sm font-bold text-ink">{selected.name}</p>
              <p className="text-xs font-medium capitalize text-muted">
                {selected.roles[0] || "Staff"} · {selected.online ? "App open" : "Offline"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
              className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest cursor-pointer"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="py-2.5">
            <p className="text-xs font-semibold text-ink" id="duty-status-label">Shift Status</p>
            {duty.canChange ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-labelledby="duty-status-label">
                {(["on", "break", "off"] as const).map((st) => {
                  const active = selected.status === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={pending}
                      aria-pressed={active}
                      onClick={() => changeStatus(selected.id, st)}
                      className={`min-h-10 rounded-input text-xs font-semibold capitalize transition-all cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-forest ${
                        active
                          ? st === "on" ? "bg-forest text-white" : st === "break" ? "bg-amber-600 text-white" : "bg-neutral-700 text-white"
                          : "border border-line bg-surface text-muted hover:bg-paper"
                      }`}
                    >
                      {st === "on" ? "On Duty" : st === "break" ? "Break" : "Off"}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-xs font-semibold capitalize text-forest">
                {selected.status === "on" ? "On duty" : selected.status === "break" ? "On break" : "Off duty"}
              </p>
            )}
            {pending && <p className="mt-2 text-xs font-medium text-muted" role="status">Updating…</p>}
            {error && <p className="mt-2 text-xs font-semibold text-rose-700" role="alert">{error}</p>}
          </div>

          <div className="border-t border-line pt-2 text-right">
            <Link href="/console/team" className="inline-flex min-h-10 items-center text-xs font-semibold text-forest hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-forest">
              View Full Profile →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
