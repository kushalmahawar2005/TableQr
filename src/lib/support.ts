// How a restaurant reaches Tableeqr: a phone call or a WhatsApp chat with the operator.
// SUPPORT_PHONE (10 digits) in the hosting panel overrides the number.

const DIGITS = (process.env.SUPPORT_PHONE ?? "6367828788").replace(/\D/g, "").slice(-10);

export const SUPPORT_PHONE = DIGITS;
export const supportCallUrl = () => `tel:+91${DIGITS}`;
/** Opens WhatsApp with the message already typed */
export const supportWhatsAppUrl = (message: string) => `https://wa.me/91${DIGITS}?text=${encodeURIComponent(message)}`;

/** WhatsApp chat with a restaurant's contact, message already typed */
export const whatsAppTo = (phone: string, message: string) => {
  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").slice(-10);
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
};
