"use client";

import { Bike, FileText } from "lucide-react";
import Link from "next/link";
import { useLiveOrderCounts } from "@/lib/live-order-counts";
import { focusRing } from "./dashboard-shared";

/** New orders at the top of the Dashboard, until the kitchen starts them */
export function NewOrdersStrip() {
  const { table, guest } = useLiveOrderCounts();
  const total = table + guest;
  if (!total) return null;
  const parts = [guest > 0 && `${guest} from the guest app`, table > 0 && `${table} from tables`].filter(Boolean).join(" · ");
  return <Link href={guest > 0 ? "/console/orders?view=delivery" : "/console/orders"} className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-card border border-[var(--state-available)]/50 bg-[var(--state-available-soft)] px-4 py-3 ${focusRing}`}>
    <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink"><FileText className="size-4 shrink-0 text-[var(--state-available-text)]" aria-hidden="true" />{total} new {total === 1 ? "order" : "orders"}<span className="font-medium text-muted">{parts}</span></span>
    <span className="text-sm font-semibold text-forest">Open</span>
  </Link>;
}

/** Quick link to guest app orders, with how many are waiting */
export function DeliveryOrdersLink({ wide }: { /** Fills the row on a phone when it would sit alone */ wide: boolean }) {
  const { guest } = useLiveOrderCounts();
  return <Link href="/console/orders?view=delivery" className={`${wide ? "col-span-2 sm:col-span-1 " : ""}inline-flex h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-card border border-line bg-surface px-2 text-xs font-semibold text-ink transition-all hover:border-forest/40 sm:px-4 ${focusRing}`}>
    <Bike className="size-4 text-terracotta" aria-hidden="true" /><span>Delivery Orders</span>
    {guest > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white tabular">{guest}</span>}
  </Link>;
}
