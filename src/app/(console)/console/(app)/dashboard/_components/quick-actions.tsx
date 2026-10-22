import { BarChart3, Calendar, ChevronRight, Clock, CreditCard, FileText, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { focusRing } from "./dashboard-shared";

/** Every quick action is a real route that already exists; Day Close keeps its own safety flow */
export function QuickActions() {
  return (
    <nav aria-label="Quick links" className="flex flex-wrap items-center gap-2 pb-1">
      <Link
        href="/console/floor"
        className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-card bg-forest px-4 text-sm font-semibold text-white shadow-float transition-all hover:bg-forest-hover active:scale-[0.98] ${focusRing}`}
      >
        <Plus className="size-4 stroke-[2.5]" aria-hidden="true" />
        <span>Open Floor</span>
        <ChevronRight className="size-4 text-white/70" aria-hidden="true" />
      </Link>
      {[
        { href: "/console/floor", label: "New Order", icon: ShoppingBag },
        { href: "/console/billing", label: "Take Payment", icon: CreditCard },
        { href: "/console/reservations", label: "Reservations", icon: Calendar },
        { href: "/console/orders", label: "View Orders", icon: FileText },
        { href: "/console/reports", label: "Reports", icon: BarChart3 },
        { href: "/console/reports/day-close", label: "Day Close", icon: Clock },
      ].map(({ href, label, icon: Icon }) => (
        <Link
          key={label}
          href={href}
          className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-card border border-line bg-surface px-3 text-sm font-semibold text-ink transition-all hover:border-forest/40 hover:bg-paper active:scale-[0.98] ${focusRing}`}
        >
          <Icon className="size-4 text-terracotta" aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
