import { Banknote, CheckCircle2, CreditCard, Smartphone, Wallet } from "lucide-react";
import Link from "next/link";
import type { RecentPaymentItem } from "@/server/staff/dashboard";
import { EmptyLine, Panel, formatTimeAgo, money, viewAllClass } from "./dashboard-shared";

const methodIcon = (m: string) =>
  m === "cash" ? Banknote : m === "card" ? CreditCard : m === "upi" ? Smartphone : m === "wallet" ? Wallet : CreditCard;

const methodLabel = (m: string) =>
  m === "cash" ? "Cash" : m === "card" ? "Card" : m === "upi" ? "UPI" : m === "wallet" ? "Wallet" : m.replace(/_/g, " ");

/**
 * The most recent real transactions (spec §14). Rows are informational: the console has no
 * bill-detail route to deep-link to, so the panel's one link is the billing screen — no fake
 * row links.
 */
export function RecentPayments({ payments, timezone }: { payments: RecentPaymentItem[]; timezone: string }) {
  void timezone;
  return (
    <Panel
      title="Recent Payments"
      action={<Link href="/console/billing" className={viewAllClass}><span>View all</span></Link>}
    >
      {payments.length === 0 ? (
        <EmptyLine>No payments yet today.</EmptyLine>
      ) : (
        <div className="divide-y divide-line">
          {payments.slice(0, 5).map((p) => {
            const Icon = methodIcon(p.method);
            const failed = p.status === "failed" || p.status === "payment_failed";
            const pending = p.status === "pending" || p.status === "awaiting_payment";
            return (
              <div key={p.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-input bg-sage text-forest">
                    <Icon className="size-4.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{p.tableCode ? `Table ${p.tableCode}` : "Table"} payment</p>
                    <p className="text-xs font-medium capitalize text-muted">
                      {methodLabel(p.method)} · {formatTimeAgo(p.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-bold text-ink tabular">{money(p.amountPaise)}</span>
                  {failed ? (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold capitalize text-rose-700">Failed</span>
                  ) : pending ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold capitalize text-amber-700">Pending</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-700">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      <span className="hidden min-[400px]:inline">Paid</span>
                    </span>
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
