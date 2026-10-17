// How a restaurant reaches TableQR: a phone call or a WhatsApp chat with the operator.
// SUPPORT_PHONE (10 digits) in the hosting panel overrides the number.

const DIGITS = (process.env.SUPPORT_PHONE ?? "6367828788").replace(/\D/g, "").slice(-10);

export const SUPPORT_PHONE = DIGITS;
export const supportCallUrl = () => `tel:+91${DIGITS}`;
/** Opens WhatsApp with the message already typed */
export const supportWhatsAppUrl = (message: string) => `https://wa.me/91${DIGITS}?text=${encodeURIComponent(message)}`;

/** The operator's UPI ID that restaurants pay their fees to (TABLEQR_UPI_ID in the hosting panel); null when not set */
export const feesUpiId = () => process.env.TABLEQR_UPI_ID?.trim() || null;

/** Opens any UPI app with TableQR, the amount and a note already filled in */
export const upiPayUrl = (upiId: string, rupees: number, note: string) =>
  `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent("TableQR")}&am=${rupees.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note.slice(0, 50))}`;

/** WhatsApp chat with a restaurant's contact, message already typed */
export const whatsAppTo = (phone: string, message: string) => {
  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").slice(-10);
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
};
