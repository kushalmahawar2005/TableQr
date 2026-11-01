import type { ComponentProps, ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AttendanceScreen } from "@/app/(console)/console/(app)/attendance/_components/attendance-screen";
import { CustomersScreen } from "@/app/(console)/console/(app)/customers/_components/customers-screen";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { DashboardScreen } from "@/app/(console)/console/(app)/dashboard/_components/dashboard-screen";
import { InventoryScreen } from "@/app/(console)/console/(app)/inventory/_components/inventory-screen";
import { RoomsScreen } from "@/app/(console)/console/(app)/rooms/_components/rooms-screen";
import { WaitlistScreen } from "@/app/(console)/console/(app)/waitlist/_components/waitlist-screen";
import { consoleSections } from "@/lib/console-nav";
import { DEFAULT_PLANS } from "@/lib/plan-features";
import { dashboardCases } from "../o1/_fixtures";

export const metadata: Metadata = { title: "Screens (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const pro = DEFAULT_PLANS.find((p) => p.code === "hotel_plus")!.features;
const item = (id: string, name: string, unit: string, qtyMilli: number, lowMilli: number | null, costPaise: number | null, category: string | null, over: Record<string, unknown> = {}) => ({ id, name, unit, qtyMilli, lowMilli, costPaise, low: lowMilli !== null && qtyMilli <= lowMilli, category, packName: null, packMilli: null, isPrep: false, usedIn: 2, prep: [], ...over });
const inventory = {
  stockValuePaise: 1_842_000, stockSoldOut: true,
  items: [item("1", "Paneer", "kg", 1_500, 3_000, 32_000, "Dairy", { packName: "pack", packMilli: 1_000 }), item("2", "Milk", "l", 18_000, 5_000, 6_000, "Dairy"), item("3", "Onion", "kg", 0, 5_000, 3_500, "Vegetables"), item("4", "Tomato", "kg", 12_000, 4_000, 4_000, "Vegetables", { usedIn: 0 }), item("5", "Garam masala with a long supplier name", "g", 900_000, null, 90, "Masale"), item("6", "Makhani gravy", "kg", 6_000, 2_000, null, "Prep", { isPrep: true, prep: [{ stockItemId: "4", qtyMilli: 800 }] })],
  dishes: [{ id: "d1", name: "Paneer Tikka", category: "Starters", heldByStock: false, recipe: [{ stockItemId: "1", qtyMilli: 200 }] }, { id: "d2", name: "Onion Soup", category: "Soups", heldByStock: true, recipe: [{ stockItemId: "3", qtyMilli: 150 }] }, { id: "d3", name: "Plain Rice", category: "Mains", heldByStock: false, recipe: [] }],
  moves: [{ id: "m1", stockItemId: "1", kind: "sale", qtyMilli: -200, note: null, createdAt: Date.now() - 3_600_000, by: null }, { id: "m2", stockItemId: "1", kind: "purchase", qtyMilli: 5_000, note: "Bill 104", createdAt: Date.now() - 86_400_000, by: "Rohan" }, { id: "m3", stockItemId: "3", kind: "wastage", qtyMilli: -1_000, note: "Spoiled", createdAt: Date.now() - 7_200_000, by: "Rohan" }],
} as unknown as ComponentProps<typeof InventoryScreen>["initial"];
const purchasing = { suppliers: [{ id: "s1", name: "Sharma Dairy", phone: "+91 98765 43210", gstin: null, billedPaise: 500_000, returnedPaise: 0, paidPaise: 300_000, duePaise: 200_000 }], bills: [], payments: [] } as unknown as ComponentProps<typeof InventoryScreen>["purchasing"];

const room = (id: string, number: string, status: string, over: Record<string, unknown> = {}) => ({ id, number, status, roomType: "Deluxe", floorLabel: "First floor", guestPath: `/r/SRJ01/room/${number}`, stay: null, requests: [], ...over });
const rooms = { waiters: [], maxRooms: 30, canManage: true, canBill: true, rooms: [room("r1", "101", "vacant"), room("r2", "102", "cleaning"), room("r3", "103", "blocked")] } as unknown as ComponentProps<typeof RoomsScreen>["initial"];
const stays = [] as unknown as ComponentProps<typeof RoomsScreen>["history"];
const customers = { total: 2, page: 1, pages: 1, counts: { all: 2, regulars: 1, offers: 1, away: 0 }, customers: [{ phone: "9876543210", name: "Rohan Sharma", visits: 4, lastVisitAt: Date.now() - 86_400_000, bookings: 1, noShows: 0, spendPaise: 512_000, offersOk: true, firstSeenAt: Date.now() - 864_000_000, companions: { names: [], unnamed: 0 } }, { phone: "9000000000", name: null, visits: 1, lastVisitAt: Date.now(), bookings: 0, noShows: 0, spendPaise: 12_000, offersOk: false, firstSeenAt: Date.now(), companions: { names: [], unnamed: 0 } }] } as unknown as ComponentProps<typeof CustomersScreen>["data"];
const register = { date: "2026-11-01", today: "2026-11-01", outletId: "o", outlets: [{ id: "o", name: "Spice Route" }], counts: { present: 1, half_day: 0, absent: 0, leave: 0, week_off: 0, unmarked: 1 }, people: [{ id: "1", name: "Rohan Sharma", photoUrl: null, roles: ["manager"], status: "present", note: null }, { id: "2", name: "Anjali Mehta", photoUrl: null, roles: ["waiter"], status: null, note: null }] } as unknown as ComponentProps<typeof AttendanceScreen>["day"];

// Development-only review board for console screens, with sample data
export default async function ScreensBoard(props: { searchParams: Promise<{ p?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { p = "inventory" } = await props.searchParams;
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  const hotel = dashboardCases()[0];
  const screens: Record<string, ReactNode> = {
    inventory: <InventoryScreen initial={inventory} purchasing={purchasing} />,
    rooms: <RoomsScreen initial={rooms} history={stays} />,
    waitlist: <WaitlistScreen entries={[]} outlet="Spice Route" outletCode="SRJ01" freeTables={[]} canManage />,
    customers: <CustomersScreen data={customers} q="" filter="all" outletName="Spice Route" />,
    attendance: <AttendanceScreen day={register} month={null} />,
    dashboard: <DashboardScreen initial={{ ...hotel.data, kpis: { ...hotel.data.kpis, rooms: { total: 30, occupied: 12, cleaning: 3, available: 15 } }, alerts: { ...hotel.data.alerts, roomRequests: 2 } }} initialTrend={hotel.trend} features={pro} preview={{}} />,
  };
  return <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug={p as "inventory"} preview>{screens[p]}</StaffShell>;
}
