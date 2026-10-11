import "server-only";

// WhatsApp Business (Meta Cloud API): sends the bill PDF straight to the guest's number. WhatsApp
// lets a business start a chat only with an approved template, so the PDF goes as the header of
// a utility template (WHATSAPP_BILL_TEMPLATE) whose body is one line with the restaurant name as
// {{1}}, e.g. "Your bill from {{1}}." Unset keys = off: staff send it from their own WhatsApp.

const config = () => ({
  token: process.env.WHATSAPP_TOKEN ?? "",
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  template: process.env.WHATSAPP_BILL_TEMPLATE ?? "",
  lang: process.env.WHATSAPP_TEMPLATE_LANG || "en",
  version: process.env.WHATSAPP_API_VERSION || "v21.0",
});

export function whatsappReady() {
  const c = config();
  return !!(c.token && c.phoneId && c.template);
}

type Fetch = typeof fetch;

async function call(f: Fetch, url: string, init: RequestInit) {
  const res = await f(url, init);
  const body = (await res.json().catch(() => ({}))) as { id?: string; messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message || `WhatsApp answered ${res.status}`);
  return body;
}

/** Uploads the PDF and sends it to `to` (91XXXXXXXXXX); returns WhatsApp's message id */
export async function sendWhatsAppPdf(input: { to: string; pdf: Uint8Array; filename: string; outletName: string }, f: Fetch = fetch): Promise<string> {
  const c = config();
  if (!whatsappReady()) throw new Error("WhatsApp is not connected.");
  const base = `https://graph.facebook.com/${c.version}/${c.phoneId}`;
  const auth = { Authorization: `Bearer ${c.token}` };

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([new Uint8Array(input.pdf)], { type: "application/pdf" }), input.filename);
  const media = await call(f, `${base}/media`, { method: "POST", headers: auth, body: form });
  if (!media.id) throw new Error("WhatsApp did not accept the PDF.");

  const sent = await call(f, `${base}/messages`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: {
        name: c.template,
        language: { code: c.lang },
        components: [
          { type: "header", parameters: [{ type: "document", document: { id: media.id, filename: input.filename } }] },
          { type: "body", parameters: [{ type: "text", text: input.outletName.slice(0, 60) }] },
        ],
      },
    }),
  });
  return sent.messages?.[0]?.id ?? "";
}
