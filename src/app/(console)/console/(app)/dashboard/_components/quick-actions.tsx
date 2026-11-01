import type { Features } from "@/lib/plan-features";
import { BarChart3, BedDouble, Calendar, Clock, CreditCard, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { focusRing } from "./dashboard-shared";
import { DeliveryOrdersLink } from "./live-orders";

/** Every quick action is a real route that already exists; Day Close keeps its own safety flow */
export function QuickActions({ features }: { features?: Features }) {
  const primary = features?.dineIn
    ? { href: "/console/floor", label: "Open Floor", icon: Plus }
    : features?.rooms
      ? { href: "/console/rooms", label: "Open Rooms", icon: Plus }
      : features?.pos
        ? { href: "/console/pos", label: "New counter order", icon: Plus }
        : { href: "/console/billing", label: "Take Payment", icon: CreditCard };
  const secondary = [
    ...(features?.rooms ? [{ href: "/console/rooms", label: "Rooms", icon: BedDouble }] : []),
    { href: "/console/billing", label: "Take Payment", icon: CreditCard },
    { href: "/console/reservations", label: "Reservations", icon: Calendar },
    { href: "/console/orders", label: "View Orders", icon: FileText },
    { href: "/console/reports", label: "Reports", icon: BarChart3 },
    { href: "/console/reports/day-close", label: "Day Close", icon: Clock },
  ].filter(action => action.href !== primary.href).filter(action => action.label !== "Reservations" || features?.reservations).filter(action => !["Reports", "Day Close"].includes(action.label) || features?.fullReports);
  return (
    <nav aria-label="Quick links" className="grid w-full grid-cols-2 items-stretch gap-2 sm:flex sm:w-auto sm:flex-wrap">
      <Link
        href={primary.href}
        className={`${secondary.length % 2 === 0 ? "col-span-2 sm:col-span-1 " : ""}inline-flex h-11 items-center justify-center gap-2 rounded-card bg-forest px-4 text-sm font-semibold text-white shadow-float transition-all hover:bg-forest-hover active:scale-[0.98] sm:col-span-1 ${focusRing}`}
      >
        <primary.icon className="size-4 stroke-[2.5]" aria-hidden="true" />
        <span>{primary.label}</span>
      </Link>
      {secondary.map(({ href, label, icon: Icon }) => (
        <Link
          key={label}
          href={href}
          className={`inline-flex h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-card border border-line bg-surface px-2 text-xs font-semibold text-ink sm:px-4 transition-all hover:border-forest/40 hover:bg-paper active:scale-[0.98] sm:text-sm ${focusRing}`}
        >
          <Icon className="size-4 text-terracotta" aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
      {features?.delivery && <DeliveryOrdersLink />}
    </nav>
  );
}
