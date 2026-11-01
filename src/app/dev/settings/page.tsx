import type { ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { CustomDomainSettings } from "@/app/(console)/console/(app)/settings/_components/custom-domain-settings";
import { PrinterSettingsUnavailable } from "@/app/(console)/console/(app)/settings/_components/printer-settings";
import { RestaurantPaymentSettings } from "@/app/(console)/console/(app)/settings/_components/restaurant-payment-settings";
import { SettingsScreen } from "@/app/(console)/console/(app)/settings/_components/settings-screen";
import { DEFAULT_DELIVERY_POLICY } from "@/domain/delivery";
import { consoleSections } from "@/lib/console-nav";

export const metadata: Metadata = { title: "Settings (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type O = ComponentProps<typeof SettingsScreen>["o"];
const o = {
  name: "Spice Route", code: "SRJ01", timezone: "Asia/Kolkata", city: "Jaipur", address: "MI Road, Jaipur", gstin: "", fssai: "", logoUrl: null, businessType: "restaurant",
  serviceChargeBp: 0, tipPresetsBp: [500, 1000], autoAcceptOrders: true, confirmFirstTableOrder: true, guestOnlinePayments: false, guestOnlinePaymentAvailable: false, sessionMode: "verified", reviewUrl: "",
  availableGuestServices: ["reservations", "rooms"], guestServices: ["reservations", "rooms"], guestPwaCustomizationAvailable: true, guestPwaInstallEnabled: false,
  announcementActive: false, announcementTitle: "", announcementBody: "", bookingAdvancePaise: 0, bookingGatewayAvailable: false, bookingPaymentMode: "manual_qr", bookingPaymentQrUrl: null, upiId: "", upiName: "",
  deliveryAvailable: true, pickupAvailable: true, deliveryPolicy: DEFAULT_DELIVERY_POLICY, roomServices: [], wifiSsid: "", wifiPassword: "", openingHours: null, plan: "Base", tables: 12, staff: 5,
  customDomain: null, customDomainToken: null, customDomainVerifiedAt: null, customDomainLive: false,
  paymentGateway: { configured: false, available: false, mode: "sandbox" },
} as unknown as O;

// Development-only review board for the Settings screen, with sample data
export default function SettingsBoard() {
  if (process.env.NODE_ENV === "production") notFound();
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  return (
    <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug="settings" preview>
      <SettingsScreen o={o} canEdit payments={<RestaurantPaymentSettings initial={o.paymentGateway} canEdit />} printers={<PrinterSettingsUnavailable />} domain={<CustomDomainSettings domain={null} token={null} verifiedAt={null} live={false} dnsTarget={null} canEdit />} />
    </StaffShell>
  );
}
