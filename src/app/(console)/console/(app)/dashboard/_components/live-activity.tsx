import { BellRing, CalendarCheck, CircleDollarSign, ReceiptText } from "lucide-react";
import type { ActivityFeedItem } from "@/server/staff/dashboard";
import { EmptyLine, Panel, formatTimeAgo, money } from "./dashboard-shared";

/** Real outlet events, newest first (spec §16) */
export function LiveActivity({ feed, live = false }: { feed: ActivityFeedItem[]; live?: boolean }) {
  const icons = {
    payment: { Icon: CircleDollarSign, bg: "bg-sage", fg: "text-forest" },
    order: { Icon: ReceiptText, bg: "bg-terracotta/15", fg: "text-terracotta" },
    request: { Icon: BellRing, bg: "bg-amber-100", fg: "text-amber-700" },
    reservation: { Icon: CalendarCheck, bg: "bg-sky-100", fg: "text-sky-700" },
  } as const;

  return (
    <Panel
      title="Live Activity"
      action={live ? <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />Live</span> : undefined}
    >
      {feed.length === 0 ? (
        <EmptyLine>No activity yet today — payments, orders and requests will appear here.</EmptyLine>
      ) : (
        <ul className="divide-y divide-line">
          {feed.slice(0, 6).map((item) => {
            const { Icon, bg, fg } = icons[item.type] ?? icons.order;
            return (
              <li key={item.id} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                <span className={`grid size-9 shrink-0 place-items-center rounded-full ${bg} ${fg}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0 truncate text-sm font-bold text-ink">{item.title}</span>
                    <span className="shrink-0 text-xs font-medium text-muted tabular">{formatTimeAgo(item.timestamp)}</span>
                  </p>
                  <p className="mt-1 truncate text-[13px] font-medium text-muted">
                    {item.subtitle}
                    {item.amountPaise ? ` · ${money(item.amountPaise)}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
