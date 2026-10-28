"use client";

import { useState } from "react";
import type { DeliveryPolicy } from "@/domain/delivery";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeliverySettings({ value, onChange, disabled, hasGateway, hasPaymentQr }: {
  value: DeliveryPolicy; onChange: (next: DeliveryPolicy) => void; disabled: boolean; hasGateway: boolean; hasPaymentQr: boolean;
}) {
  // Keep text while typing, including separators, without losing incomplete pincodes.
  const [codes, setCodes] = useState(value.pincodes.join(", "));
  const update = (patch: Partial<DeliveryPolicy>) => onChange({ ...value, ...patch });
  return <div className="space-y-5 py-5">
    <p className="rounded-xl bg-brand-soft p-3 text-sm text-ink">Online delivery payments go directly to this restaurant’s own Cashfree account. Tableeqr’s Cashfree account is only used for restaurant subscriptions.</p>
    <label className="flex min-h-11 items-center justify-between gap-4 text-sm font-semibold">
      Accept delivery orders
      <input type="checkbox" checked={value.acceptingOrders} disabled={disabled} onChange={event => update({ acceptingOrders: event.target.checked })} className="size-5 accent-[var(--brand)]" />
    </label>
    <div className="space-y-2"><Label htmlFor="delivery-pincodes">Delivery pincodes</Label>
      <textarea id="delivery-pincodes" value={codes} disabled={disabled} maxLength={800} rows={3} placeholder="302001, 302002" className="w-full rounded-xl border border-line bg-surface p-3 text-sm" onChange={event => { setCodes(event.target.value); update({ pincodes: event.target.value.split(/[\s,;]+/).filter(Boolean) }); }} />
      <p className="text-xs text-muted">Separate six-digit pincodes with commas. Only these areas will be accepted; up to 100 pincodes.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      {([
        ["minimumOrderPaise", "Minimum food order (₹)"],
        ["deliveryFeePaise", "Final delivery charge (₹)"],
        ["freeDeliveryAbovePaise", "Free delivery from (₹)"],
      ] as const).map(([key, label]) => <div className="space-y-2" key={key}><Label htmlFor={`delivery-${key}`}>{label}</Label>
        <Input id={`delivery-${key}`} type="number" min="0" max="100000" step="0.01" value={value[key] === null ? "" : value[key] / 100} disabled={disabled} onChange={event => update({ [key]: event.target.value === "" && key === "freeDeliveryAbovePaise" ? null : Math.round(Number(event.target.value) * 100) })} />
        {key === "freeDeliveryAbovePaise" && <p className="text-xs text-muted">Leave blank to always charge the delivery fee.</p>}
      </div>)}
      <div className="space-y-2"><Label htmlFor="delivery-eta">Estimated delivery time (minutes)</Label><Input id="delivery-eta" type="number" min="10" max="240" step="1" value={value.estimatedMinutes} disabled={disabled} onChange={event => update({ estimatedMinutes: Number(event.target.value) })} /></div>
    </div>
    <div className="space-y-2"><Label htmlFor="delivery-payment">Delivery payment method</Label>
      <select id="delivery-payment" value={value.paymentMode} disabled={disabled} className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" onChange={event => update({ paymentMode: event.target.value as DeliveryPolicy["paymentMode"] })}>
        <option value="gateway" disabled={!hasGateway}>Online prepayment · restaurant Cashfree (recommended)</option><option value="cod">Pay on delivery · rider shows a Cashfree QR or takes cash</option><option value="manual_qr" disabled={!hasPaymentQr}>Restaurant UPI QR · staff verifies receipt</option>
      </select><p className="text-xs text-muted">{value.paymentMode === "gateway" ? "Guests pay before the kitchen receives the order. Payment is verified by Cashfree and added to the bill ledger." : value.paymentMode === "manual_qr" ? "Guests pay to your saved QR and submit the UPI reference. An owner, manager or cashier checks the receipt before the order reaches the kitchen." : !hasGateway && !hasPaymentQr ? "Upload your restaurant payment QR to accept QR prepayments, or connect this restaurant’s own Cashfree account for online prepayment." : "Guests pay the delivery amount when the order arrives."}</p>
    </div>
  </div>;
}
