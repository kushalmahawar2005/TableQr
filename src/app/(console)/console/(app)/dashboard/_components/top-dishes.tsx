import type { DashboardData } from "@/server/staff/dashboard";
import { EmptyLine, Panel, money } from "./dashboard-shared";

/**
 * Top dishes from real sales data. The dashboard contract carries no dish photos, so each row
 * uses a tasteful initial tile rather than a stock image pretending to be the dish (spec §15).
 */
export function TopDishes({ data }: { data: DashboardData }) {
  return (
    <Panel title="Top Dishes Today" labelledBy="Top 5 Dishes Today">
      {data.topItems.length === 0 ? (
        <EmptyLine>No items sold yet today.</EmptyLine>
      ) : (
        <ol className="divide-y divide-line">
          {data.topItems.map((dish, i) => (
            <li key={dish.itemId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="w-5 shrink-0 text-center font-display text-sm font-bold text-muted tabular">{i + 1}</span>
              <span
                className="grid size-11 shrink-0 place-items-center rounded-input border border-line bg-paper font-display text-sm font-bold text-forest"
                aria-hidden="true"
              >
                {dish.name.trim().charAt(0).toUpperCase() || "•"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold leading-tight text-ink">{dish.name}</p>
                <p className="mt-0.5 text-xs font-medium text-muted tabular">{dish.qty} sold</p>
              </div>
              <p className="shrink-0 text-sm font-bold text-ink tabular">{money(dish.grossPaise)}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
