import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { requestBill } from "@/server/billing/payments";
import { billToken, sharedBill } from "@/server/billing/bill-link";
import { billPdf } from "@/server/billing/bill-pdf";
import { sendBillOnWhatsApp } from "@/server/billing/send-bill";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// The bill goes to the guest's WhatsApp as a PDF through WhatsApp Business; nothing opens on the
// cashier's phone. WhatsApp itself is faked here.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let sessionId: string;
const calls: { url: string; body: unknown }[] = [];

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
  const qr = env.demo.tableQr.T3;
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "sb-a", displayName: "Meera" });
  const g = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "sb-a"), "Meera");
  await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 2 });
  await placeOrder(g);
  sessionId = g.sessionId;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await env.conn.end();
  await appDb.$client.end();
});

describe("bill PDF on WhatsApp", () => {
  it("refuses while WhatsApp is not connected, and before there is a bill", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "");
    const off = await sendBillOnWhatsApp(owner, { sessionId, phone: "9876543210" }).catch((e: unknown) => e);
    expect((off as AppError).details?.reason).toBe("not_connected");
    vi.stubEnv("WHATSAPP_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_BILL_TEMPLATE", "bill_pdf");
    const early = await sendBillOnWhatsApp(owner, { sessionId, phone: "9876543210" }).catch((e: unknown) => e);
    expect((early as AppError).details?.reason).toBe("no_bill");
  });

  it("makes a one-page PDF of the bill", async () => {
    const [g] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, sessionId));
    await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId });
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, sessionId));
    const pdf = await billPdf((await sharedBill(billToken(bill.id)))!);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain("Table T3");
  });

  it("uploads the PDF and sends it as the template's document, and records the send", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body instanceof FormData ? "form" : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(url.endsWith("/media") ? { id: "media-1" } : { messages: [{ id: "wamid.1" }] }), { status: 200 });
    }));
    await expect(sendBillOnWhatsApp(owner, { sessionId, phone: "+91 98765 43210" })).resolves.toEqual({ sent: true });
    expect(calls.map((c) => c.url)).toEqual(["https://graph.facebook.com/v21.0/123/media", "https://graph.facebook.com/v21.0/123/messages"]);
    expect(calls[1].body).toMatchObject({
      to: "919876543210",
      type: "template",
      template: { name: "bill_pdf", components: [{ type: "header", parameters: [{ type: "document", document: { id: "media-1" } }] }, { type: "body" }] },
    });
    const [d] = await env.db.select().from(s.receiptDeliveries);
    expect(d).toMatchObject({ channel: "whatsapp", status: "sent", providerRef: "wamid.1", destination: "+9198xxxxxx10" });
  });

  it("tells the cashier when WhatsApp says no, and keeps the failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Template not approved" } }), { status: 400 })));
    const err = await sendBillOnWhatsApp(owner, { sessionId, phone: "9876543210" }).catch((e: unknown) => e);
    expect((err as AppError).message).toContain("Template not approved");
    const rows = await env.db.select().from(s.receiptDeliveries).where(eq(s.receiptDeliveries.status, "failed"));
    expect(rows).toHaveLength(1);
  });
});
