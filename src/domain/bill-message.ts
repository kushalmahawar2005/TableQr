// The bill as a WhatsApp message, for "Send on WhatsApp" from the billing screen and "Share" on the
// guest receipt. WhatsApp's click-to-chat link opens the chat with the text filled in; nothing is
// sent until the person taps send, so no WhatsApp Business account or template is needed.

export type BillMessage = {
  outlet: string;
  table: string;
  kind: "bill" | "receipt";
  phone?: string | null;
  date?: number | Date | string | null;
  totalPaise: number;
  paidPaise?: number;
  /** Shareable bill page; guests can view or save it as a PDF. */
  link?: string | null;
};

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function billMessage(b: BillMessage): string {
  const date = b.date ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(b.date)) : null;
  const duePaise = Math.max(0, b.totalPaise - (b.paidPaise ?? 0));
  const lines = [
    `*${b.outlet}${b.phone ? ` · ${b.phone}` : ""}*`,
    `${b.kind === "bill" ? "Bill" : "Receipt"}: ${rs(b.totalPaise)}`,
    `${b.kind === "bill" ? "Due" : "Paid"}: ${rs(b.kind === "bill" ? duePaise : (b.paidPaise ?? b.totalPaise))}`,
    date ? `Date: ${date}` : "",
    "",
    b.link ? `*View ${b.kind === "bill" ? "bill" : "receipt"}*\n${b.link}` : "",
    "",
    "Sent via Tableeqr",
  ];
  return lines.filter((line, index, all) => line !== "" || (all[index - 1] !== "" && index > 0)).join("\n").trim();
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
