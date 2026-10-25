"use client";
import { Bell, CheckCircle2, Droplets, Receipt, Sparkles, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CustomerRequestItem } from "@/server/staff/dashboard";
import { resolveServiceRequestAction } from "../actions";
import { Panel, viewAllClass } from "./dashboard-shared";

/**
 * Guest service requests with their one real action: resolve. The row leaves the list only
 * after the server accepts; a failure puts it back and says so (spec §21 mutation UX).
 */
export function CustomerRequests({ initialRequests }: { initialRequests: CustomerRequestItem[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const requests = initialRequests.filter((request) => !dismissedIds.has(request.id));
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const handleResolve = (id: string) => {
    setResolvingId(id);
    setFailed(false);
    start(async () => {
      const res = await resolveServiceRequestAction(id).catch(() => null);
      setResolvingId(null);
      if (res?.ok) {
        setDismissedIds((prev) => new Set(prev).add(id));
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  };

  const getKindDetails = (kind: string) => {
    switch (kind) {
      case "water":
        return { label: "Extra water", icon: Droplets, color: "text-sky-600 bg-sky-50", actionLabel: "Mark done" };
      case "cutlery":
        return { label: "Extra cutlery", icon: UtensilsCrossed, color: "text-amber-600 bg-amber-50", actionLabel: "Mark done" };
      case "call_waiter":
        return { label: "Waiter call", icon: Bell, color: "text-terracotta bg-terracotta/10", actionLabel: "Respond" };
      case "request_bill":
      case "pay_at_counter":
        return { label: "Bill requested", icon: Receipt, color: "text-emerald-700 bg-emerald-50", actionLabel: "Take bill" };
      case "clean_table":
        return { label: "Clean table", icon: Sparkles, color: "text-purple-600 bg-purple-50", actionLabel: "Mark done" };
      default:
        return { label: kind.replace(/_/g, " "), icon: Bell, color: "text-neutral-700 bg-neutral-100", actionLabel: "Respond" };
    }
  };

  return (
    <Panel
      title="Customer Requests"
      icon={<Bell className="size-4.5 text-terracotta" aria-hidden="true" />}
      action={<Link href="/console/floor" className={viewAllClass}><span>View all</span></Link>}
    >
      {failed && <p className="mb-2 text-xs font-semibold text-rose-700" role="alert">That didn&apos;t go through. The request is still open — try again.</p>}
      {requests.length === 0 ? (
        <p className="flex items-center gap-2 py-1 text-[13px] font-medium text-muted">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          No pending requests — guest requests will chime here.
        </p>
      ) : (
        <div className="divide-y divide-line">
          {requests.slice(0, 5).map((r) => {
            const { label, icon: Icon, color, actionLabel } = getKindDetails(r.kind);
            const isBill = r.kind === "request_bill" || r.kind === "pay_at_counter";
            const waiting = r.elapsedMinutes >= 10;
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-bold text-ink">{r.tableCode}</span>
                  {!isBill && (
                    <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${color}`}>
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{label}</p>
                    <p className={`text-[11px] tabular ${waiting ? "font-bold text-terracotta" : "text-muted"}`}>
                      {r.elapsedMinutes === 0 ? "Just now" : `${r.elapsedMinutes} min ago`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleResolve(r.id)}
                  disabled={resolvingId === r.id}
                  className={`inline-flex min-h-10 shrink-0 items-center rounded-input px-3 text-sm font-semibold transition-all cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-forest ${
                    isBill ? "bg-forest text-white hover:bg-forest-hover" : "border border-line bg-surface text-terracotta hover:border-terracotta hover:bg-terracotta/10"
                  }`}
                >
                  {resolvingId === r.id ? "Working…" : actionLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
