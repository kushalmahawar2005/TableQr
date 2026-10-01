// Demo data from the spec's running example, shared by `npm run db:seed` and the integration tests.
import { getTableName, sql } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { randomInt } from "node:crypto";
import { uuidv7 } from "../src/db/id";
import * as s from "../src/db/schema";
import { hashPin } from "../src/server/staff/pin";

export type Db = MySql2Database<typeof s>;

const rupees = (r: number) => r * 100;

const BASE62 = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const shortCode = () => Array.from({ length: 4 }, () => BASE62[randomInt(BASE62.length)]).join("");
const joinCode = () => String(randomInt(1000, 10000));

const allDay = [["00:00", "24:00"]] as [string, string][];
const everyDay = (hours: [string, string][]) => ({
  mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours,
});

/** Empties every TableQR table */
export async function wipeAll(db: Db) {
  const tables = (Object.values(s) as unknown[]).filter((v): v is MySqlTable => v instanceof MySqlTable);
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const t of tables) await db.execute(sql.raw(`TRUNCATE TABLE \`${getTableName(t)}\``));
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
}

export async function seedPlatform(db: Db) {
  const base = { groupSplit: false, pricingRules: false, suggestions: false, guestCampaigns: false, multiOutlet: false };
  await db.insert(s.plans).values([
    { code: "starter", name: "Starter", monthlyPricePaise: rupees(999), sortOrder: 0,
      features: { ...base, maxTables: 15, maxStaff: 3, bookings: "reservations_only", poweredBy: true } },
    { code: "growth", name: "Growth", monthlyPricePaise: rupees(2499), sortOrder: 1,
      features: { ...base, maxTables: 40, maxStaff: 10, bookings: "full", groupSplit: true, poweredBy: true } },
    { code: "pro", name: "Pro", monthlyPricePaise: rupees(4999), sortOrder: 2,
      features: { maxTables: 80, maxStaff: 25, bookings: "full", groupSplit: true, pricingRules: true, suggestions: true, guestCampaigns: true, multiOutlet: false, poweredBy: false } },
    { code: "chain", name: "Chain", monthlyPricePaise: null, sortOrder: 3,
      features: { maxTables: null, maxStaff: null, bookings: "full", groupSplit: true, pricingRules: true, suggestions: true, guestCampaigns: true, multiOutlet: true, poweredBy: false } },
  ]);
  const adminId = uuidv7();
  await db.insert(s.platformAdmins).values({ id: adminId, email: "admin@tableqr.local", name: "Platform Owner", role: "super_admin" });
  return { adminId };
}

type Item = {
  en: string; hi: string; desc?: string; price: number; veg: boolean; jain?: boolean;
  spice?: number | null; allergens?: string[] | null; prep?: number; station: string; terms?: string;
  tags?: ("chefs_pick" | "new" | "bestseller")[];
};

const MENU: Record<string, { hi: string; from?: string; to?: string; items: Item[] }> = {
  Breakfast: {
    hi: "नाश्ता",
    from: "08:00",
    to: "11:30",
    items: [
      { en: "Aloo Paratha", hi: "आलू पराठा", desc: "Two parathas with curd and pickle", price: 150, veg: true, spice: 1, allergens: ["gluten", "dairy"], prep: 10, station: "Tandoor", terms: "alu paratha" },
    ],
  },
  Starters: {
    hi: "स्टार्टर",
    items: [
      { en: "Paneer Tikka", hi: "पनीर टिक्का", terms: "panir tikka, paner tikka", desc: "Char-grilled cottage cheese", price: 320, veg: true, spice: 2, allergens: ["dairy"], prep: 15, station: "Tandoor", tags: ["bestseller"] },
      { en: "Hara Bhara Kebab", hi: "हरा भरा कबाब", spice: null, allergens: null, desc: "Spinach and green pea patties", price: 260, veg: true, prep: 12, station: "Tandoor" },
      { en: "Chicken Seekh Kebab", hi: "चिकन सीख कबाब", desc: "Minced chicken skewers from the tandoor", price: 360, veg: false, spice: 2, prep: 15, station: "Tandoor" },
      { en: "Chicken 65", hi: "चिकन 65", desc: "Crisp fried chicken, curry leaves", price: 340, veg: false, spice: 3, prep: 12, station: "Main" },
      { en: "Masala Papad", hi: "मसाला पापड़", allergens: [], desc: "Roasted papad, onion, tomato", price: 90, veg: true, spice: 1, prep: 5, station: "Cold" },
      { en: "Masala Fries", hi: "मसाला फ्राइज़", allergens: [], desc: "Fries tossed in chaat masala", price: 180, veg: true, spice: 1, prep: 8, station: "Main" },
    ],
  },
  Mains: {
    hi: "मेन कोर्स",
    items: [
      { en: "Butter Chicken", hi: "बटर चिकन", terms: "murgh makhani", desc: "Rich tomato gravy, mild", price: 380, veg: false, spice: 1, allergens: ["dairy", "tree_nuts"], prep: 18, station: "Main", tags: ["bestseller"] },
      { en: "Dal Makhani", hi: "दाल मखनी", terms: "daal makhani, dal makhni", desc: "Slow cooked for eight hours", price: 260, veg: true, spice: 1, allergens: ["dairy"], prep: 10, station: "Main", tags: ["chefs_pick", "bestseller"] },
      { en: "Paneer Butter Masala", hi: "पनीर बटर मसाला", terms: "panir butter masala, pbm", desc: "Cottage cheese in butter tomato gravy", price: 300, veg: true, spice: 1, allergens: ["dairy", "tree_nuts"], prep: 15, station: "Main" },
      { en: "Kadai Paneer", hi: "कड़ाही पनीर", terms: "kadhai paneer, karahi paneer, panir", desc: "Peppers, onion, kadai masala", price: 320, veg: true, spice: 2, allergens: ["dairy"], prep: 15, station: "Main" },
      { en: "Palak Paneer", hi: "पालक पनीर", terms: "palak panir", desc: "Cottage cheese in spinach gravy", price: 290, veg: true, spice: 1, allergens: ["dairy"], prep: 15, station: "Main" },
      { en: "Malai Kofta", hi: "मलाई कोफ्ता", desc: "Paneer dumplings in a creamy gravy", price: 310, veg: true, spice: 1, allergens: ["dairy", "tree_nuts"], prep: 18, station: "Main" },
      { en: "Rajma Masala", hi: "राजमा मसाला", allergens: [], desc: "Kidney beans, home style", price: 240, veg: true, spice: 2, prep: 10, station: "Main" },
      { en: "Chicken Chettinad", hi: "चिकन चेट्टिनाड", allergens: [], desc: "Black pepper and coconut, fiery", price: 400, veg: false, spice: 3, prep: 20, station: "Main" },
      { en: "Mutton Curry", hi: "मटन करी", desc: "Slow cooked goat curry", price: 460, veg: false, spice: 2, prep: 20, station: "Main", tags: ["chefs_pick"] },
    ],
  },
  Breads: {
    hi: "रोटी",
    items: [
      { en: "Butter Naan", hi: "बटर नान", spice: 0, price: 60, veg: true, jain: true, allergens: ["dairy", "gluten"], prep: 6, station: "Tandoor" },
      { en: "Tandoori Roti", hi: "तंदूरी रोटी", spice: 0, price: 40, veg: true, jain: true, allergens: ["gluten"], prep: 5, station: "Tandoor" },
      { en: "Garlic Naan", hi: "गार्लिक नान", spice: 0, price: 80, veg: true, allergens: ["dairy", "gluten"], prep: 6, station: "Tandoor" },
    ],
  },
  Rice: {
    hi: "चावल",
    items: [
      { en: "Veg Biryani", hi: "वेज बिरयानी", terms: "biriyani, vegetable biryani", desc: "Dum cooked basmati, raita on the side", price: 280, veg: true, spice: 2, allergens: ["tree_nuts", "dairy"], prep: 18, station: "Main", tags: ["new"] },
      { en: "Jeera Rice", hi: "जीरा राइस", spice: 0, allergens: [], price: 180, veg: true, jain: true, prep: 8, station: "Main" },
      { en: "Boondi Raita", hi: "बूंदी रायता", spice: 0, price: 90, veg: true, allergens: ["dairy"], prep: 3, station: "Cold" },
    ],
  },
  Desserts: {
    hi: "मिठाई",
    items: [
      { en: "Gulab Jamun", hi: "गुलाब जामुन", spice: 0, terms: "gulab jamoon", desc: "Two pieces, served warm", price: 120, veg: true, jain: true, allergens: ["dairy", "gluten"], prep: 3, station: "Dessert" },
    ],
  },
  Drinks: {
    hi: "पेय",
    items: [
      { en: "Masala Lassi", hi: "मसाला लस्सी", spice: 0, price: 110, veg: true, jain: true, allergens: ["dairy"], prep: 4, station: "Bar", tags: ["bestseller"] },
      { en: "Fresh Lime Soda", hi: "फ्रेश लाइम सोडा", spice: 0, allergens: [], price: 90, veg: true, jain: true, prep: 3, station: "Bar" },
      { en: "Cola", hi: "कोला", spice: 0, allergens: ["sulphites"], price: 70, veg: true, jain: true, prep: 1, station: "Bar" },
    ],
  },
};

type TableDef = {
  code: string; zone: string; min: number; max: number; cls: string;
  shape: "square" | "round" | "long"; x: number; y: number; combine?: string[];
};

const FLOOR: TableDef[] = [
  { code: "T1", zone: "Indoor", min: 1, max: 2, cls: "2-top", shape: "round", x: 0, y: 0 },
  { code: "T2", zone: "Indoor", min: 1, max: 2, cls: "2-top", shape: "round", x: 3, y: 0 },
  { code: "T3", zone: "Indoor", min: 2, max: 4, cls: "4-top", shape: "square", x: 6, y: 0 },
  { code: "T4", zone: "Indoor", min: 2, max: 4, cls: "4-top", shape: "square", x: 9, y: 0 },
  { code: "T5", zone: "Indoor", min: 2, max: 4, cls: "4-top", shape: "square", x: 0, y: 3, combine: ["T6"] },
  { code: "T6", zone: "Indoor", min: 2, max: 4, cls: "4-top", shape: "square", x: 3, y: 3, combine: ["T5"] },
  { code: "T7", zone: "Indoor", min: 1, max: 2, cls: "2-top", shape: "round", x: 6, y: 3 },
  { code: "T8", zone: "Indoor", min: 4, max: 8, cls: "6-top", shape: "long", x: 9, y: 3 },
  { code: "T11", zone: "Indoor", min: 2, max: 4, cls: "4-top", shape: "square", x: 0, y: 6, combine: ["T12"] },
  { code: "T12", zone: "Indoor", min: 2, max: 4, cls: "4-top", shape: "square", x: 3, y: 6, combine: ["T11"] },
  { code: "T9", zone: "Terrace", min: 2, max: 4, cls: "4-top", shape: "square", x: 0, y: 0 },
  { code: "T10", zone: "Terrace", min: 2, max: 4, cls: "4-top", shape: "square", x: 3, y: 0 },
  ...[1, 2, 3, 4, 5].map((n) => ({ code: `B${n}`, zone: "Bar", min: 1, max: 2, cls: "bar", shape: "round" as const, x: (n - 1) * 2, y: 0 })),
  { code: "P1", zone: "Private room", min: 6, max: 12, cls: "12-top", shape: "long", x: 0, y: 0 },
];

/**
 * Spice Route, Jaipur (SRJ01) on the Pro plan. Table 12 has QR k7Qm and join code 4821.
 * Pass openAllDay in tests so the outlet is open whatever the clock says.
 */
export async function seedDemo(db: Db, opts: { adminId?: string; openAllDay?: boolean } = {}) {
  const tenantId = uuidv7();
  const brandId = uuidv7();
  const outletId = uuidv7();

  await db.insert(s.tenants).values({
    id: tenantId,
    name: "Sharma Hospitality Pvt Ltd",
    planCode: "pro",
    status: "active",
    contactName: "Rohan Sharma",
    contactPhone: "9000000001",
    contactEmail: "rohan@example.com",
    createdByAdminId: opts.adminId ?? null,
  });
  const now = new Date();
  await db.insert(s.subscriptions).values({
    tenantId,
    planCode: "pro",
    pricePerOutletPaise: rupees(4999),
    status: "active",
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  });
  await db.insert(s.brands).values({ id: brandId, tenantId, name: "Spice Route" });
  await db.insert(s.outlets).values({
    id: outletId,
    tenantId,
    brandId,
    code: "SRJ01",
    name: "Spice Route",
    city: "Jaipur",
    address: "12 MI Road, Jaipur, Rajasthan 302001",
    gstin: "08AABCS1234F1Z5",
    fssai: "12225018000123",
    accentColor: "#E4572E",
    openingHours: everyDay(opts.openAllDay ? allDay : [["12:00", "23:30"]]),
    sessionMode: "open",
  });

  // Demo staff PINs are the last digit four times (owner 1111 ... kitchen 6666). Demo data only.
  const staff = [
    { name: "Rohan Sharma", phone: "9000000001", role: "owner", outlet: null },
    { name: "Meera Joshi", phone: "9000000002", role: "manager", outlet: outletId },
    { name: "Priya Singh", phone: "9000000003", role: "cashier", outlet: outletId },
    { name: "Anil Kumar", phone: "9000000004", role: "host", outlet: outletId },
    { name: "Rahul Verma", phone: "9000000005", role: "waiter", outlet: outletId },
    { name: "Ramesh Yadav", phone: "9000000006", role: "kitchen", outlet: outletId },
  ] as const;
  const staffIds: Record<string, string> = {};
  for (const p of staff) {
    const userId = uuidv7();
    staffIds[p.role] = userId;
    await db.insert(s.users).values({ id: userId, tenantId, name: p.name, phone: p.phone, pinHash: await hashPin(p.phone.slice(-1).repeat(4)) });
    await db.insert(s.staffRoles).values({ tenantId, userId, outletId: p.outlet, role: p.role });
  }

  const zoneIds: Record<string, string> = {};
  for (const [i, name] of ["Indoor", "Terrace", "Bar", "Private room"].entries()) {
    zoneIds[name] = uuidv7();
    await db.insert(s.zones).values({ id: zoneIds[name], tenantId, outletId, name, sortOrder: i });
  }
  const tableIds: Record<string, string> = {};
  const tableQr: Record<string, string> = {};
  for (const t of FLOOR) tableIds[t.code] = uuidv7();
  for (const t of FLOOR) {
    tableQr[t.code] = t.code === "T12" ? "k7Qm" : shortCode();
    await db.insert(s.diningTables).values({
      id: tableIds[t.code],
      tenantId,
      outletId,
      zoneId: zoneIds[t.zone],
      code: t.code,
      minSeats: t.min,
      maxSeats: t.max,
      tableClass: t.cls,
      shape: t.shape,
      posX: t.x,
      posY: t.y,
      width: t.shape === "long" ? 4 : 2,
      combinableWith: t.combine?.map((c) => tableIds[c]) ?? null,
      joinCode: t.code === "T12" ? "4821" : joinCode(),
    });
    await db.insert(s.qrCodes).values({ tenantId, outletId, tableId: tableIds[t.code], type: "table", shortCode: tableQr[t.code] });
  }
  await db.insert(s.qrCodes).values([
    { tenantId, outletId, type: "entrance", shortCode: "door" },
    { tenantId, outletId, type: "booking", shortCode: "book" },
  ]);

  const itemIds: Record<string, string> = {};
  let catOrder = 0;
  for (const [nameEn, cat] of Object.entries(MENU)) {
    const categoryId = uuidv7();
    await db.insert(s.menuCategories).values({
      id: categoryId, tenantId, brandId, nameEn, nameHi: cat.hi, sortOrder: catOrder++,
      availableFrom: cat.from ?? null, availableTo: cat.to ?? null,
    });
    for (const [i, it] of cat.items.entries()) {
      itemIds[it.en] = uuidv7();
      await db.insert(s.menuItems).values({
        id: itemIds[it.en],
        tenantId,
        brandId,
        categoryId,
        nameEn: it.en,
        nameHi: it.hi,
        descriptionEn: it.desc ?? null,
        pricePaise: rupees(it.price),
        isVeg: it.veg,
        isJain: it.jain ?? false,
        // Not given = not stated by the restaurant
        spiceLevel: it.spice ?? null,
        allergens: it.allergens ?? null,
        searchTerms: it.terms ?? null,
        prepMinutes: it.prep ?? 15,
        station: it.station,
        tags: it.tags ?? null,
        sortOrder: i,
      });
    }
  }

  // Butter Chicken options, as drawn on the item sheet (G4)
  const breadGroup = uuidv7();
  const addOnGroup = uuidv7();
  await db.insert(s.modifierGroups).values([
    { id: breadGroup, tenantId, itemId: itemIds["Butter Chicken"], nameEn: "Choose bread", nameHi: "रोटी चुनें", minSelect: 1, maxSelect: 1, sortOrder: 0 },
    { id: addOnGroup, tenantId, itemId: itemIds["Butter Chicken"], nameEn: "Add-ons", nameHi: "ऐड-ऑन", minSelect: 0, maxSelect: 3, sortOrder: 1 },
  ]);
  const modifierIds = { butterNaan: uuidv7(), tandooriRoti: uuidv7(), noBread: uuidv7(), extraGravy: uuidv7() };
  await db.insert(s.modifiers).values([
    { id: modifierIds.butterNaan, tenantId, groupId: breadGroup, nameEn: "Butter naan", nameHi: "बटर नान", priceDeltaPaise: rupees(60), sortOrder: 0 },
    { id: modifierIds.tandooriRoti, tenantId, groupId: breadGroup, nameEn: "Tandoori roti", nameHi: "तंदूरी रोटी", priceDeltaPaise: rupees(40), sortOrder: 1 },
    { id: modifierIds.noBread, tenantId, groupId: breadGroup, nameEn: "No bread", nameHi: "रोटी नहीं", priceDeltaPaise: 0, sortOrder: 2 },
    { id: modifierIds.extraGravy, tenantId, groupId: addOnGroup, nameEn: "Extra gravy", nameHi: "एक्स्ट्रा ग्रेवी", priceDeltaPaise: rupees(30), sortOrder: 0 },
  ]);

  // Mutton Curry out today, Butter Chicken portion counter (O3)
  await db.insert(s.outletItemOverrides).values([
    { tenantId, outletId, itemId: itemIds["Mutton Curry"], isAvailable: false },
    { tenantId, outletId, itemId: itemIds["Butter Chicken"], portionsLeft: 12 },
  ]);

  const itemCount = Object.values(MENU).reduce((n, c) => n + c.items.length, 0);
  return {
    tenantId, brandId, outletId, outletCode: "SRJ01", tableIds, tableQr, itemIds, modifierIds, staffIds, zoneIds,
    counts: { tables: FLOOR.length, categories: Object.keys(MENU).length, items: itemCount, staff: staff.length },
  };
}

/** A second, unrelated restaurant used to prove tenants cannot see each other */
export async function seedOtherTenant(db: Db) {
  const tenantId = uuidv7();
  const brandId = uuidv7();
  const outletId = uuidv7();
  const zoneId = uuidv7();
  const tableId = uuidv7();
  const categoryId = uuidv7();
  const itemId = uuidv7();
  await db.insert(s.tenants).values({ id: tenantId, name: "Nukkad Cafes LLP", planCode: "starter", status: "active", contactName: "Isha Rao", contactPhone: "9000000099" });
  await db.insert(s.brands).values({ id: brandId, tenantId, name: "Cafe Nukkad" });
  await db.insert(s.outlets).values({ id: outletId, tenantId, brandId, code: "CNJ01", name: "Cafe Nukkad", city: "Jaipur", address: "C Scheme, Jaipur", openingHours: everyDay(allDay) });
  await db.insert(s.zones).values({ id: zoneId, tenantId, outletId, name: "Indoor" });
  await db.insert(s.diningTables).values({ id: tableId, tenantId, outletId, zoneId, code: "T1", maxSeats: 2, tableClass: "2-top", joinCode: "1111" });
  await db.insert(s.qrCodes).values({ tenantId, outletId, tableId, type: "table", shortCode: "nk01" });
  await db.insert(s.menuCategories).values({ id: categoryId, tenantId, brandId, nameEn: "Coffee" });
  await db.insert(s.menuItems).values({ id: itemId, tenantId, brandId, categoryId, nameEn: "Cold Coffee", pricePaise: 15000, isVeg: true, station: "Bar" });
  return { tenantId, outletId, outletCode: "CNJ01", tableId, tableQr: "nk01", itemId };
}
