import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { placeLabel } from "@/domain/delivery";
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
      <dl className="grid grid-cols-3 gap-2 rounded-input bg-sage px-3 py-2.5">
        {[["active", orders.length], ["preparing", preparing], ["ready", ready]].map(([name, count]) => (
          <div key={name} className="flex flex-col-reverse">
            <dt className="text-[11px] font-medium text-muted">{name}</dt>
            <dd className="font-display text-lg font-bold leading-6 text-ink tabular">{count}</dd>
          </div>
        ))}
      </dl>
      {orders.length === 0 ? (
        <EmptyLine>Kitchen is clear — no active tickets.</EmptyLine>
      ) : (
        <div className="mt-3 divide-y divide-line">
          {preview.map((o) => {
            const delayed = o.elapsedMinutes >= 20 && o.status !== "ready";
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-ink">{placeLabel(o.tableCode, o.guestName)}</p>
                  <p className="mt-0.5 truncate text-[13px] font-medium text-muted">{o.items}</p>
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
