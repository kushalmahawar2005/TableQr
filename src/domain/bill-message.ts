// The bill as a WhatsApp message, for "Send on WhatsApp" from the billing screen and "Share" on the
// guest receipt. WhatsApp's click-to-chat link opens the chat with the text filled in; nothing is
// sent until the person taps send, so no WhatsApp Business account or template is needed.

export type BillMessage = {
  outlet: string;
  table: string;
  kind: "bill" | "receipt";
  number?: string | null;
  lines: { name: string; qty: number; amountPaise: number }[];
  subtotalPaise: number;
  discountPaise?: number;
  serviceChargePaise?: number;
  taxPaise?: number;
  roundOffPaise?: number;
  totalPaise: number;
  paidPaise?: number;
};

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function billMessage(b: BillMessage): string {
  const lines = [
    `*${b.outlet}*`,
    `${b.kind === "bill" ? "Bill" : "Receipt"} · Table ${b.table}${b.number ? ` · ${b.number}` : ""}`,
    "",
    ...b.lines.map((l) => `${l.qty} × ${l.name} — ${rs(l.amountPaise)}`),
    "",
    `Items: ${rs(b.subtotalPaise)}`,
    b.discountPaise ? `Discount: −${rs(b.discountPaise)}` : "",
    b.serviceChargePaise ? `Service charge: ${rs(b.serviceChargePaise)}` : "",
    b.taxPaise ? `GST: ${rs(b.taxPaise)}` : "",
    b.roundOffPaise ? `Round off: ${b.roundOffPaise < 0 ? "−" : ""}${rs(Math.abs(b.roundOffPaise))}` : "",
    `*Total: ${rs(b.totalPaise)}*`,
    b.paidPaise ? `Paid: ${rs(b.paidPaise)}` : "",
    "",
    "Thank you for dining with us!",
  ];
  return lines.filter((l, i, all) => l !== "" || (all[i - 1] !== "" && i > 0)).join("\n").trim();
}

/** A 10-digit Indian mobile, with or without +91, as WhatsApp wants it (91XXXXXXXXXX); null if not one */
export function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `91${local}` : null;
}

/** Click-to-chat link: to a number when given, else WhatsApp asks whom to send it to */
export function whatsappLink(text: string, phone?: string | null): string {
  const to = phone ? whatsappNumber(phone) : null;
  return `https://wa.me/${to ?? ""}?text=${encodeURIComponent(text)}`;
}
