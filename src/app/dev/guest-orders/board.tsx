"use client";
import type { ComponentProps } from "react";
import "@/app/(guest)/r/[outlet]/guest-app.css";
import { GuestSplash } from "@/app/(guest)/r/[outlet]/_components/guest-ui";
import { StatusView } from "@/app/(guest)/r/[outlet]/delivery/screen";
import { CustomerOrders } from "@/app/(guest)/r/[outlet]/orders/screen";

type Status = ComponentProps<typeof StatusView>["status"];
const id = "01a1930f-3971-7512-a2e8-c366f77af44a";
const base = { id, estimatedMinutes: 35, minutesLeft: 25, billPdfUrl: "#", billBreakdown: { subtotalPaise: 10_000, serviceChargePaise: 0, roundOffPaise: 0, discountPaise: 0, taxPaise: 0 }, status: "placed", kitchenStatus: "accepted", serviceMode: "delivery", placedAt: Date.parse("2026-10-31T17:43:30Z"), items: [{ name: "Fruit Bowl", nameHi: null, qty: 1, unitPricePaise: 10_000, imageUrl: null, modifiers: [{ nameEn: "Large", nameHi: null }] }], name: "Kushal", address: { line: "SP-40, Arya College Road, Andheri Deori", locality: "Ajmer", pincode: "305901", instructions: "" }, totalPaise: 10_000, deliveryFeePaise: 0, paid: false, paymentMode: "cod", paymentStatus: "pending", paymentFailureReason: null, refundStatus: "none", courierName: null, courierPhone: null, courierPhotoUrl: null, courierVehicleNo: null, courierVerified: false, riderLocation: null, deliveryPin: null, courierRating: null, myRating: null, canRate: false };
const states: Record<string, Record<string, unknown>> = {
  confirmed: {}, preparing: { kitchenStatus: "preparing", minutesLeft: 12 }, delayed: { kitchenStatus: "preparing", minutesLeft: -5 }, packed: { kitchenStatus: "ready", minutesLeft: 15 },
  way: { status: "dispatched", kitchenStatus: "ready", courierName: "Kushal Mahawar", courierPhone: "+919876543210", courierRating: { rating: 4, ratings: 1, rides: 4 }, deliveryPin: "4821" },
  delivered: { status: "delivered", kitchenStatus: "served", paid: true, paymentStatus: "paid", courierName: "Kushal Mahawar", courierRating: { rating: 4, ratings: 1, rides: 4 }, canRate: true },
  cancelled: { status: "cancelled", items: [], totalPaise: 27_000, billBreakdown: null, billPdfUrl: null },
};
const history = { guest: { name: "Kushal", phone: "9876543210" }, addresses: [], bookings: [], deliveries: [
  { id, sessionId: "a", serviceMode: "delivery", status: "placed", totalPaise: 10_000, at: "2026-10-31T17:43:30Z", paymentMode: "cod", paymentStatus: "pending", lines: [{ qty: 1 }], address: null, items: [{ name: "Fruit Bowl · Large", qty: 1, imageUrl: null }] },
  { id: "01a18c3a-77fd-7247-b269-54d5bdf4b046", sessionId: null, serviceMode: "delivery", status: "cancelled", totalPaise: 27_000, at: "2026-10-30T09:53:24Z", paymentMode: "cod", paymentStatus: "pending", lines: [{ qty: 2 }], address: null, items: [] },
  { id: "01a18963-5d05-774b-9b32-a5c7689138be", sessionId: "b", serviceMode: "delivery", status: "delivered", totalPaise: 10_000, at: "2026-10-29T20:39:12Z", paymentMode: "cod", paymentStatus: "paid", lines: [{ qty: 1 }], address: null, items: [{ name: "Fruit Bowl", qty: 1, imageUrl: null }] },
] } as unknown as ComponentProps<typeof CustomerOrders>["initial"];

// Development-only review of the guest order screens, with sample data
export function Board({ view, dark }: { view: string; dark: boolean }) {
  const shell = { "--brand-main": "#a84a30", "--brand-strong": "#a84a30", "--brand-on": "#fff", "--brand-soft": dark ? "#3a2b27" : "#f5e9e3" } as React.CSSProperties;
  return (
    <div className="mx-auto w-full max-w-[480px] overflow-hidden px-4 min-[360px]:px-5"><div className="guest-app" data-appearance={dark ? "dark" : "light"} style={shell}>
      {view === "loading" ? <GuestSplash name="The fit bowl" />
        : view === "orders" ? <CustomerOrders outlet="DEMO" brandName="The fit bowl" initial={history} />
        : <div className="pt-5 pb-8"><StatusView outletCode="DEMO" status={{ ...base, ...states[view] } as unknown as Status} hindi={false} pending={false} statusMessage="" onRefresh={async () => null} newOrderHref="/dev/guest-orders?new=1" /></div>}
    </div></div>
  );
}
