// Writes sample slips (receipt, kitchen ticket, order slip, day close) for both roll widths to
// a folder, to open in a browser and print-preview at 100% scale by hand:
//   npx tsx scripts/print-previews.ts [folder]
// The page height in these files is an estimate; the app measures the real height just before it
// prints. In the print dialog: Headers and footers off, Margins None, Scale 100%.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { orderSlipHtml } from "../src/app/(console)/console/(app)/orders/_components/order-slip-print";
import { dayCloseHtml } from "../src/app/(console)/console/(app)/reports/day-close/_components/day-close-print";
import { billHtml } from "../src/app/pos/_components/bill-print";
import { kotHtml } from "../src/app/(staff)/kds/_components/kot-print";
import type { PosBillDetail } from "../src/server/staff/pos-read";
import { ADDRESS_LONG, billDetail, busyDayClose, dayClose, kotCard, kotLine, manyLines, orderSlip } from "../test/fixtures/print-fixtures";

const out = path.resolve(process.argv[2] ?? "print-previews");
mkdirSync(out, { recursive: true });

for (const paper of [80, 58] as const) {
  const cases: Record<string, string> = {
    "receipt-1-item": billHtml(billDetail(), "Spice Route", "receipt", paper),
    "receipt-20-items": billHtml(billDetail({ ...manyLines(20) }), "Spice Route", "receipt", paper),
    "receipt-long-names": billHtml(billDetail({
      seller: { name: "The Grand Royal Rajasthani Thali and Kebab House", address: ADDRESS_LONG, city: "Jaipur", gstin: "08AABCS1234F1Z5", fssai: "12345678901234" } as PosBillDetail["seller"],
      lines: [{ name: "Hyderabadi Dum Biryani with Extra Raita, Salan and Mirchi Ka Salan Combo Family Pack", qty: 3, unitPricePaise: 45000, note: "parcel", status: "served" }, { name: "Butter Naan", qty: 6, unitPricePaise: 4500, note: null, status: "served" }],
    } as never), "Spice Route", "receipt", paper),
    "receipt-discount-tax-cash-online": billHtml(billDetail({
      bill: { subtotalPaise: 100000, discountPaise: 10000, serviceChargePaise: 5000, deliveryFeePaise: 0, taxPaise: 5000, taxBreakup: { "500": 4000, "1800": 1000 }, roundOffPaise: 12, totalPaise: 100012 } as never,
      payments: [{ method: "cash", status: "success", amountPaise: 50000, tipPaise: 0 }, { method: "upi", status: "success", amountPaise: 50012, tipPaise: 0 }] as never,
    }), "Spice Route", "receipt", paper),
    "bill-takeaway": billHtml(billDetail({ takeaway: true, tableCode: "TA-12", invoice: null }), "Spice Route", "bill", paper),
    "kot-1-item": kotHtml([kotCard()], paper),
    "kot-long": kotHtml([kotCard({
      orderNote: "Guest has a nut allergy, use separate utensils",
      lines: [
        kotLine({ qty: 2, nameEn: "Hyderabadi Dum Biryani with Extra Raita and Salan", modifiers: [{ en: "Extra spicy", hi: null }, { en: "No onion, no garlic, sauce on the side", hi: null }], note: "Cook well done" }),
        kotLine({ qty: 1, nameEn: "Butter Naan", personalForPickup: true }),
        kotLine({ qty: 4, nameEn: "Masala Chai", modifiers: [{ en: "Less sugar", hi: null }] }),
      ],
    })], paper),
    "kot-parcel": kotHtml([kotCard({ tableCodes: ["TA-3"], lines: [kotLine({ qty: 2, nameEn: "Veg Biryani", personalForPickup: true })] })], paper),
    "order-slip": orderSlipHtml(orderSlip(), "Spice Route", paper),
    "day-summary": dayCloseHtml(dayClose(), "BMW", paper),
    "day-close-busy": dayCloseHtml(busyDayClose(), "Spice Route Kitchen & Cafe", paper),
  };
  for (const [name, html] of Object.entries(cases)) writeFileSync(path.join(out, `${name}-${paper}mm.html`), html);
}
console.log(`Wrote previews to ${out}`);
