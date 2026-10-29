"use client";

import { useState } from "react";
import type { DeliveryPolicy } from "@/domain/delivery";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeliverySettings({ value, onChange, disabled, hasGateway, hasPaymentQr, hasDelivery, hasPickup }: {
  value: DeliveryPolicy;
  onChange: (next: DeliveryPolicy) => void;
  disabled: boolean;
  hasGateway: boolean;
  hasPaymentQr: boolean;
  hasDelivery: boolean;
  hasPickup: boolean;
}) {
  // Keep text while typing, including separators, without losing incomplete pincodes.
  const [codes, setCodes] = useState(value.pincodes.join(", "));
  const update = (patch: Partial<DeliveryPolicy>) => onChange({ ...value, ...patch });
  const deliveryOn = hasDelivery && value.acceptingOrders;
  const pickupOn = hasPickup && value.acceptingPickupOrders;
  const anyServiceOn = deliveryOn || pickupOn;
  const minimumLabel = deliveryOn && pickupOn ? "Minimum food order (₹)" : pickupOn ? "Minimum pickup order (₹)" : "Minimum delivery order (₹)";

  return <div className="space-y-5 py-5">
    <div className="rounded-2xl border border-brand-border bg-brand-soft/40 p-4">
      <p className="text-sm font-semibold text-ink">Guests only see the online services you turn on.</p>
      <p className="mt-1 text-sm text-muted">Online payment choices use this outlet’s connected payment setup. Pickup does not ask guests for a delivery address.</p>
    </div>
    {hasDelivery && <label className="flex min-h-[4.5rem] cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink">
      <span><span className="block">Accept delivery orders</span><span className="mt-0.5 block text-xs font-normal text-muted">{value.acceptingOrders ? "Guests can place delivery orders." : "Delivery is hidden from guests."}</span></span>
      <input type="checkbox" checked={value.acceptingOrders} disabled={disabled} onChange={event => update({ acceptingOrders: event.target.checked })} className="size-5 shrink-0 accent-[var(--brand)]" />
    </label>}
    {hasPickup && <label className="flex min-h-[4.5rem] cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink">
      <span><span className="block">Accept pickup / takeaway orders</span><span className="mt-0.5 block text-xs font-normal text-muted">{value.acceptingPickupOrders ? "Guests can order online and collect at your counter." : "Pickup is hidden from guests."}</span></span>
      <input type="checkbox" checked={value.acceptingPickupOrders} disabled={disabled} onChange={event => update({ acceptingPickupOrders: event.target.checked })} className="size-5 shrink-0 accent-[var(--brand)]" />
    </label>}

    {pickupOn && <label className="flex min-h-[4.5rem] cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink">
      <span><span className="block">Allow pay at pickup</span><span className="mt-0.5 block text-xs font-normal text-muted">Guests can pay at the counter when collecting.</span></span>
      <input type="checkbox" checked={value.pickupCodEnabled} disabled={disabled} onChange={event => update({ pickupCodEnabled: event.target.checked })} className="size-5 shrink-0 accent-[var(--brand)]" />
    </label>}
    {pickupOn && !value.pickupCodEnabled && !hasGateway && !hasPaymentQr && <p className="rounded-xl bg-[var(--state-held-soft)] p-3 text-xs text-[var(--state-held-text)]">Pickup cannot accept orders yet. Turn on pay at pickup, connect Cashfree, or add a payment QR.</p>}

    {anyServiceOn && <div className="space-y-2">
      <Label htmlFor="delivery-minimum">{minimumLabel}</Label>
      <Input id="delivery-minimum" type="number" min="0" max="100000" step="0.01" value={value.minimumOrderPaise / 100} disabled={disabled} onChange={event => update({ minimumOrderPaise: Math.round(Number(event.target.value) * 100) })} />
      {deliveryOn && pickupOn && <p className="text-xs text-muted">This minimum applies to both online delivery and pickup orders.</p>}
    </div>}

    {deliveryOn && <>
      <div className="space-y-2"><Label htmlFor="delivery-pincodes">Delivery pincodes</Label>
        <textarea id="delivery-pincodes" value={codes} disabled={disabled} maxLength={800} rows={3} placeholder="302001, 302002" className="w-full rounded-xl border border-line bg-surface p-3 text-sm" onChange={event => { setCodes(event.target.value); update({ pincodes: event.target.value.split(/[\s,;]+/).filter(Boolean) }); }} />
        <p className="text-xs text-muted">Separate six-digit pincodes with commas. Only these areas will be accepted; up to 100 pincodes.</p>
        {!value.pincodes.length && <p role="status" className="text-xs font-semibold text-[var(--state-held-text)]">Add at least one pincode before saving delivery settings.</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="delivery-fee">Delivery charge (₹)</Label><Input id="delivery-fee" type="number" min="0" max="100000" step="0.01" value={value.deliveryFeePaise / 100} disabled={disabled} onChange={event => update({ deliveryFeePaise: Math.round(Number(event.target.value) * 100) })} /></div>
        <div className="space-y-2"><Label htmlFor="delivery-free-above">Free delivery from (₹)</Label><Input id="delivery-free-above" type="number" min="0" max="100000" step="0.01" value={value.freeDeliveryAbovePaise === null ? "" : value.freeDeliveryAbovePaise / 100} disabled={disabled} onChange={event => update({ freeDeliveryAbovePaise: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100) })} /><p className="text-xs text-muted">Leave blank to always charge the delivery fee.</p></div>
        <div className="space-y-2"><Label htmlFor="delivery-eta">Estimated delivery time (minutes)</Label><Input id="delivery-eta" type="number" min="10" max="240" step="1" value={value.estimatedMinutes} disabled={disabled} onChange={event => update({ estimatedMinutes: Number(event.target.value) })} /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="delivery-payment">Delivery payment method</Label>
        <select id="delivery-payment" value={value.paymentMode} disabled={disabled} className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" onChange={event => update({ paymentMode: event.target.value as DeliveryPolicy["paymentMode"] })}>
          <option value="gateway" disabled={!hasGateway}>Online prepayment · Cashfree (recommended)</option><option value="cod">Pay on delivery · cash or QR</option><option value="manual_qr" disabled={!hasPaymentQr}>Saved UPI QR · staff verifies receipt</option>
        </select><p className="text-xs text-muted">{value.paymentMode === "gateway" ? "Guests pay before the order reaches the kitchen. Payment is verified automatically." : value.paymentMode === "manual_qr" ? "Guests pay to your saved QR. Staff checks the payment before the order reaches the kitchen." : !hasGateway && !hasPaymentQr ? "Connect Cashfree or add a payment QR to offer online prepayment." : "Guests pay when the order arrives."}</p>
      </div>
    </>}
  </div>;
}
