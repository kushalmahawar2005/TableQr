import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { KitchenOrderItem } from "@/server/staff/dashboard";
import { EmptyLine, Panel, viewAllClass } from "./dashboard-shared";

/** Kitchen snapshot: real counts plus the most urgent tickets first (spec §12) */
export function KitchenOrders({ orders }: { orders: KitchenOrderItem[] }) {
  const preparing = orders.filter((o) => o.status === "preparing").length;
  const ready = orders.filter((o) => o.status === "ready").length;
  const preview = [...orders]
    .sort((a, b) => (a.status === "ready" ? 0 : 1) - (b.status === "ready" ? 0 : 1) || b.elapsedMinutes - a.elapsedMinutes)
    .slice(0, 4);

  return (
    <Panel
      title="Kitchen"
      action={<Link href="/console/kitchen" className={viewAllClass}><span>Open kitchen</span></Link>}
    >
      <p className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium text-muted">
        <span><strong className="text-ink tabular">{orders.length}</strong> active orders</span>
        <span aria-hidden="true">·</span>
        <span><strong className="text-ink tabular">{preparing}</strong> preparing</span>
        <span aria-hidden="true">·</span>
        <span><strong className="text-ink tabular">{ready}</strong> ready</span>
      </p>
      {orders.length === 0 ? (
        <EmptyLine>Kitchen is clear — no active tickets.</EmptyLine>
      ) : (
        <div className="mt-2 divide-y divide-line">
          {preview.map((o) => {
            const delayed = o.elapsedMinutes >= 20 && o.status !== "ready";
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-bold text-ink">{o.tableCode}</span>
                  <p className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-snug text-ink">{o.items}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {o.status === "ready" ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                      <CheckCircle2 className="size-3" aria-hidden="true" /> Ready
                    </span>
                  ) : delayed ? (
                    <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">Delayed</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 capitalize">{o.status}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
