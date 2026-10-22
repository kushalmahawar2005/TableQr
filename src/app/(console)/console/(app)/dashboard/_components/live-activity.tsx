import { BellRing, CalendarCheck, CircleDollarSign, UtensilsCrossed } from "lucide-react";
import type { ActivityFeedItem } from "@/server/staff/dashboard";
import { EmptyLine, Panel, formatTimeAgo, money } from "./dashboard-shared";

/** Real outlet events, newest first (spec §16) */
export function LiveActivity({ feed }: { feed: ActivityFeedItem[] }) {
  const icons = {
    payment: { Icon: CircleDollarSign, bg: "bg-sage", fg: "text-forest" },
    order: { Icon: UtensilsCrossed, bg: "bg-terracotta/15", fg: "text-terracotta" },
    request: { Icon: BellRing, bg: "bg-amber-100", fg: "text-amber-700" },
    reservation: { Icon: CalendarCheck, bg: "bg-sky-100", fg: "text-sky-700" },
  } as const;

  return (
    <Panel title="Live Activity">
      {feed.length === 0 ? (
        <EmptyLine>No activity yet today — payments, orders and requests will appear here.</EmptyLine>
      ) : (
        <ul className="space-y-3">
          {feed.slice(0, 6).map((item) => {
            const { Icon, bg, fg } = icons[item.type] ?? icons.order;
            return (
              <li key={item.id} className="flex items-start gap-3">
                <span className={`grid size-9 shrink-0 place-items-center rounded-full ${bg} ${fg}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="truncate text-sm font-bold text-ink">{item.title}</span>
                    <span className="shrink-0 text-xs font-medium text-muted tabular">{formatTimeAgo(item.timestamp)}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[13px] font-medium text-muted">
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
