import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { exchangeSignupCode, metaRequest, openWhatsAppToken, sealWhatsAppToken } from "./meta";

const id = (value: string) => { if (!/^\d{1,40}$/.test(value)) throw new AppError("invalid_state", "The WhatsApp account selection is invalid."); return value; };

export async function whatsappOverview(tenantId: string) {
  const [account] = await db.select({ id: s.whatsappAccounts.id, status: s.whatsappAccounts.status, displayPhone: s.whatsappAccounts.displayPhone, verifiedName: s.whatsappAccounts.verifiedName, qualityRating: s.whatsappAccounts.qualityRating, messagingTier: s.whatsappAccounts.messagingTier }).from(s.whatsappAccounts).where(eq(s.whatsappAccounts.tenantId, tenantId));
  const templates = account ? await db.select({ id: s.whatsappTemplates.id, name: s.whatsappTemplates.name, language: s.whatsappTemplates.language, category: s.whatsappTemplates.category, header: s.whatsappTemplates.header, body: s.whatsappTemplates.body, buttons: s.whatsappTemplates.buttons, status: s.whatsappTemplates.status, rejectionReason: s.whatsappTemplates.rejectionReason }).from(s.whatsappTemplates).where(and(eq(s.whatsappTemplates.tenantId, tenantId), eq(s.whatsappTemplates.accountId, account.id))).orderBy(asc(s.whatsappTemplates.name)) : [];
  return { account: account ?? null, templates };
}

export async function connectWhatsApp(tenantId: string, input: { code: string; wabaId: string; phoneNumberId: string; pin: string }) {
  const wabaId = id(input.wabaId), phoneNumberId = id(input.phoneNumberId);
  if (!/^\d{6}$/.test(input.pin)) throw new AppError("invalid_state", "Enter a six-digit WhatsApp registration PIN.");
  const token = await exchangeSignupCode(input.code);
  // The signup event is untrusted. Query the granted WABA and confirm the chosen phone belongs to it.
  const numbers = await metaRequest<{ data: Array<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string }> }>(`${wabaId}/phone_numbers`, token, { params: { fields: "id,display_phone_number,verified_name,quality_rating,messaging_limit_tier", limit: "100" } });
  const number = numbers.data?.find((phone) => phone.id === phoneNumberId);
  if (!number) throw new AppError("forbidden", "This phone number was not granted to the selected WhatsApp account.");
  const encrypted = sealWhatsAppToken(tenantId, token);
  // Claim locally before registering/subscribing; unique phone_number_id prevents cross-tenant takeover.
  const accountId = await db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    if (!tenant) throw new AppError("not_found", "Restaurant not found.");
    const [account] = await tx.select().from(s.whatsappAccounts).where(eq(s.whatsappAccounts.tenantId, tenantId)).for("update");
    if (account && (account.wabaId !== wabaId || account.phoneNumberId !== phoneNumberId)) throw new AppError("invalid_state", "This restaurant is linked to another WhatsApp number. Ask Tableeqr to migrate the account.");
    if (account) {
      await tx.update(s.whatsappAccounts).set({ accessToken: encrypted, status: "error" }).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, account.id)));
      return account.id;
    }
    const [created] = await tx.insert(s.whatsappAccounts).values({ tenantId, wabaId, phoneNumberId, accessToken: encrypted, status: "error" }).$returningId();
    return created.id;
  });
  const registration = await metaRequest<{ success: boolean }>(`${phoneNumberId}/register`, token, { method: "POST", body: { messaging_product: "whatsapp", pin: input.pin } });
  if (!registration.success) throw new AppError("invalid_state", "WhatsApp phone registration was not completed.");
  const subscription = await metaRequest<{ success: boolean }>(`${wabaId}/subscribed_apps`, token, { method: "POST", body: {} });
  if (!subscription.success) throw new AppError("invalid_state", "WhatsApp account subscription was not completed.");
  await db.update(s.whatsappAccounts).set({ status: "connected", connectedAt: new Date(), displayPhone: number.display_phone_number?.slice(0, 30) ?? null, verifiedName: number.verified_name?.slice(0, 120) ?? null, qualityRating: number.quality_rating?.slice(0, 20) ?? null, messagingTier: number.messaging_limit_tier?.slice(0, 30) ?? null, lastError: null }).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, accountId), eq(s.whatsappAccounts.accessToken, encrypted), eq(s.whatsappAccounts.status, "error")));
}

async function connectedAccount(tenantId: string) {
  const [account] = await db.select().from(s.whatsappAccounts).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.status, "connected")));
  if (!account) throw new AppError("invalid_state", "Connect your WhatsApp Business account first.");
  return { ...account, token: openWhatsAppToken(tenantId, account.accessToken) };
}

type MetaTemplate = { id: string; name: string; language: string; category: string; status: string; rejected_reason?: string; components?: Array<{ type: string; format?: string; text?: string; buttons?: s.TemplateButton[] }> };
export async function syncWhatsAppTemplates(tenantId: string) {
  const account = await connectedAccount(tenantId);
  const templates: MetaTemplate[] = [];
  let after = "";
  for (let page = 0; page < 100; page++) {
    const result = await metaRequest<{ data: MetaTemplate[]; paging?: { next?: string; cursors?: { after?: string } } }>(`${account.wabaId}/message_templates`, account.token, { params: { fields: "id,name,language,category,status,components,rejected_reason", limit: "100", ...(after ? { after } : {}) } });
    templates.push(...result.data);
    if (!result.paging?.next) break;
    const next = result.paging.cursors?.after;
    if (!next || next === after || page === 99) throw new AppError("invalid_state", "The template list could not be loaded completely. Try again.");
    after = next;
  }
  await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const [current] = await tx.select({ id: s.whatsappAccounts.id }).from(s.whatsappAccounts).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, account.id), eq(s.whatsappAccounts.status, "connected"))).for("update");
    if (!current) throw new AppError("invalid_state", "The WhatsApp connection changed. Refresh and retry.");
    // A template omitted by Meta must not remain approved locally.
    await tx.update(s.whatsappTemplates).set({ status: "disabled" }).where(and(eq(s.whatsappTemplates.tenantId, tenantId), eq(s.whatsappTemplates.accountId, account.id)));
    for (const template of templates) {
      if (template.category !== "MARKETING" && template.category !== "UTILITY") continue;
      const status = template.status.toLowerCase();
      const header = template.components?.find((c) => c.type === "HEADER");
      const values = { metaTemplateId: template.id, category: template.category as "MARKETING" | "UTILITY", header: (header?.format === "IMAGE" ? "image" : header?.format === "VIDEO" ? "video" : "none") as "image" | "video" | "none", body: template.components?.find((c) => c.type === "BODY")?.text ?? "", footer: template.components?.find((c) => c.type === "FOOTER")?.text ?? null, buttons: template.components?.find((c) => c.type === "BUTTONS")?.buttons ?? null, status: (s.templateStatuses as readonly string[]).includes(status) ? status as typeof s.templateStatuses[number] : "disabled" as const, rejectionReason: template.rejected_reason?.slice(0, 300) ?? null };
      await tx.insert(s.whatsappTemplates).values({ tenantId, accountId: account.id, name: template.name, language: template.language, ...values }).onDuplicateKeyUpdate({ set: values });
    }
  });
  return templates.length;
}

export async function submitWhatsAppTemplate(tenantId: string, input: { name: string; language: string; body: string; examples: string[]; header: "none" | "image" | "video"; headerExample?: string }) {
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(input.name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.language) || !input.body.trim() || input.body.length > 1024) throw new AppError("invalid_state", "Enter a template name, language and message (up to 1024 characters).");
  if (!["none", "image", "video"].includes(input.header)) throw new AppError("invalid_state", "Choose a supported template header.");
  const variables = [...input.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const count = Math.max(0, ...variables);
  if (count > 20 || new Set(variables).size !== count || input.examples.length !== count || input.examples.some((e) => !e.trim() || e.length > 200)) throw new AppError("invalid_state", "Use sequential variables {{1}}, {{2}} and supply one example for each.");
  const account = await connectedAccount(tenantId);
  const components: unknown[] = [];
  if (input.header !== "none") {
    if (!input.headerExample || input.headerExample.length > 4096) throw new AppError("invalid_state", "Add the sample media handle from Meta for this header.");
    components.push({ type: "HEADER", format: input.header.toUpperCase(), example: { header_handle: [input.headerExample] } });
  }
  components.push({ type: "BODY", text: input.body.trim(), ...(count ? { example: { body_text: [input.examples] } } : {}) });
  const created = await metaRequest<{ id: string; status: string }>(`${account.wabaId}/message_templates`, account.token, { method: "POST", body: { name: input.name, language: input.language, category: "MARKETING", components } });
  // Store immediately so a subsequent sync failure cannot hide an accepted submission.
  const values = { metaTemplateId: created.id, header: input.header, body: input.body.trim(), status: created.status === "APPROVED" ? "approved" as const : "pending" as const, rejectionReason: null };
  await db.insert(s.whatsappTemplates).values({ tenantId, accountId: account.id, name: input.name, language: input.language, category: "MARKETING", ...values }).onDuplicateKeyUpdate({ set: values });
}

export async function disconnectWhatsApp(tenantId: string) {
  // Revoke Tableeqr's local use immediately; keep template/campaign history for reports.
  await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const [account] = await tx.select({ id: s.whatsappAccounts.id }).from(s.whatsappAccounts).where(eq(s.whatsappAccounts.tenantId, tenantId)).for("update");
    if (!account) return;
    await tx.update(s.whatsappAccounts).set({ accessToken: "", status: "disconnected" }).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, account.id)));
    await tx.update(s.whatsappTemplates).set({ status: "disabled" }).where(and(eq(s.whatsappTemplates.tenantId, tenantId), eq(s.whatsappTemplates.accountId, account.id)));
  });
}
