import "server-only";
import { readDeliveryPolicy, type DeliveryPolicy } from "@/domain/delivery";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { configuredRoomRequestKinds, type RoomRequestKind } from "@/domain/rooms";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";
import { configuredGuestServices, guestServices, type GuestService } from "@/domain/guest-services";
import { tenantFeatures } from "../plan";
import { outletPaymentGatewayStatus } from "../payments/outlet-gateway";

// Outlet profile (read-only): the signed-in outlet's details and its setup counts, scoped to the
// tenant and outlet.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;

export type OutletSettings = {
  deliveryPolicy: DeliveryPolicy; deliveryAvailable: boolean;
  guestOnlinePaymentAvailable: boolean; bookingGatewayAvailable: boolean;
  paymentGateway: Awaited<ReturnType<typeof outletPaymentGatewayStatus>>;
  name: string; code: string; city: string; address: string; gstin: string | null; fssai: string | null; timezone: string; logoUrl: string | null;
  sessionMode: string; autoAcceptOrders: boolean; guestOnlinePayments: boolean; serviceChargeBp: number; tipPresetsBp: number[] | null; reviewUrl: string | null;
  openingHours: Record<string, [string, string][]> | null;
  roomServices: RoomRequestKind[]; wifiSsid: string; wifiPassword: string;
  customDomain: string | null; customDomainVerifiedAt: Date | null; customDomainToken: string | null; customDomainLive: boolean;
  guestServices: GuestService[]; availableGuestServices: GuestService[];
  bookingPaymentMode: "gateway" | "manual_qr"; bookingPaymentQrUrl: string | null; upiId: string | null; upiName: string | null;
  bookingAdvancePaise: number;
  announcementActive: boolean; announcementTitle: string; announcementBody: string;
  tables: number; staff: number; plan: string;
};

/** Brand mark for the signed-in outlet, available to the shared staff header on every role. */
export async function outletLogoFor(staff: Pick<StaffSession, "tenantId" | "outletId">): Promise<string | null> {
  const [row] = await db.select({ logoUrl: s.brands.logoUrl })
    .from(s.outlets)
    .innerJoin(s.brands, and(eq(s.brands.tenantId, staff.tenantId), eq(s.brands.id, s.outlets.brandId)))
    .where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  return row?.logoUrl ?? null;
}

export async function getOutletSettings(staff: Staff): Promise<OutletSettings> {
  if (!canSee(staff, "settings")) throw new AppError("forbidden", "Your role cannot view settings.");
  const [outlet] = await db.select().from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  const [[tables], [team], [plan], [brand], features] = await Promise.all([
    db.select({ n: count() }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.isActive, true))),
    db.select({ n: count() }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, staff.tenantId))),
    db.select({ name: s.plans.name }).from(s.tenants).innerJoin(s.plans, eq(s.tenants.planCode, s.plans.code)).where(eq(s.tenants.id, staff.tenantId)),
    db.select({ logoUrl: s.brands.logoUrl }).from(s.brands).where(and(eq(s.brands.tenantId, staff.tenantId), eq(s.brands.id, outlet.brandId))),
    tenantFeatures(staff.tenantId),
  ]);
  const paymentGateway = await outletPaymentGatewayStatus(staff.tenantId, staff.outletId);
  return {
    deliveryPolicy: readDeliveryPolicy(outlet.deliveryPolicy), deliveryAvailable: features.delivery,
    guestOnlinePaymentAvailable: paymentGateway.available, bookingGatewayAvailable: paymentGateway.available, paymentGateway,
    name: outlet.name, code: outlet.code, city: outlet.city, address: outlet.address, gstin: outlet.gstin, fssai: outlet.fssai, timezone: outlet.timezone, logoUrl: brand?.logoUrl ?? null,
    sessionMode: outlet.sessionMode, autoAcceptOrders: outlet.autoAcceptOrders, guestOnlinePayments: outlet.guestOnlinePayments, serviceChargeBp: outlet.serviceChargeBp, tipPresetsBp: outlet.tipPresetsBp,
    reviewUrl: outlet.reviewUrl, openingHours: outlet.openingHours, tables: Number(tables.n), staff: Number(team.n), plan: plan?.name ?? "",
    roomServices: configuredRoomRequestKinds(outlet.roomServices), wifiSsid: outlet.wifiSsid ?? "", wifiPassword: outlet.wifiPassword ?? "",
    guestServices: configuredGuestServices(outlet.guestServices), availableGuestServices: guestServices.filter(service => features[service]),
    bookingPaymentMode: outlet.bookingPaymentMode, bookingPaymentQrUrl: outlet.bookingPaymentQrUrl, upiId: outlet.upiId, upiName: outlet.upiName,
    bookingAdvancePaise: outlet.bookingAdvancePaise,
    announcementActive: outlet.announcementActive, announcementTitle: outlet.announcementTitle ?? "", announcementBody: outlet.announcementBody ?? "",
    customDomain: outlet.customDomain ?? null, customDomainVerifiedAt: outlet.customDomainVerifiedAt ?? null, customDomainToken: outlet.customDomainToken ?? null, customDomainLive: outlet.customDomainLive,
  };
}
