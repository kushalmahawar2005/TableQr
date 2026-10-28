import type { BroadcastTemplateSnapshot } from "@/db/schema/broadcast";

export function isBroadcastQuietTime(now: Date, timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 9 || hour >= 21;
}

export function publicBroadcastUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) || url.hostname.endsWith(".local")) throw new Error("Use a public HTTPS link.");
  return url.href;
}

export function broadcastVariableCount(body: string) {
  const values = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const max = Math.max(0, ...values);
  if (max > 20 || new Set(values).size !== max || /\{\{|\}\}/.test(body.replace(/\{\{\d+\}\}/g, ""))) throw new Error("This template uses unsupported variables. Choose a template with {{1}}, {{2}} in sequence.");
  return max;
}

export type BroadcastContent = { variables: string[]; headerMediaUrl: string | null; linkUrl: string | null; offerCode: string | null };
/** MySQL JSON can reorder object keys; compare the fields in a fixed order. */
export function broadcastTemplateSignature(template: BroadcastTemplateSnapshot | null) {
  return template ? JSON.stringify([template.name, template.language, template.body, template.header, template.buttons?.map((b) => [b.type, b.text, b.url ?? null]) ?? null]) : "";
}
export function broadcastTemplatePayload(template: BroadcastTemplateSnapshot, content: BroadcastContent, recipient: { name: string | null }, callbackId: string) {
  if (broadcastVariableCount(template.body) !== content.variables.length) throw new Error("Fill every template variable.");
  const render = (value: string) => value.replaceAll("{name}", recipient.name?.trim().split(/\s+/)[0] || "Guest").replaceAll("{offer}", content.offerCode ?? "").replaceAll("{link}", content.linkUrl ?? "");
  const values = content.variables.map(render);
  if (values.some((value) => !value.trim() || value.length > 900)) throw new Error("Template values must be filled and shorter than 900 characters.");
  const components: unknown[] = [];
  if (template.header !== "none") {
    if (!content.headerMediaUrl) throw new Error("Add the template's photo or video.");
    const link = publicBroadcastUrl(content.headerMediaUrl);
    components.push({ type: "header", parameters: [{ type: template.header, [template.header]: { link } }] });
  }
  if (values.length) components.push({ type: "body", parameters: values.map((text) => ({ type: "text", text })) });
  for (const [index, button] of (template.buttons ?? []).entries()) {
    if (button.type === "URL" && button.url?.includes("{{1}}")) {
      const [prefix, suffix] = button.url.split("{{1}}");
      if (suffix || !content.linkUrl || !publicBroadcastUrl(content.linkUrl).startsWith(prefix)) throw new Error("The button link must match the URL approved for this template.");
      const text = content.linkUrl.slice(prefix.length);
      if (!text) throw new Error("Complete the template's button link.");
      components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text }] });
    } else if (button.type === "COPY_CODE") {
      if (!content.offerCode) throw new Error("This template needs an offer code.");
      components.push({ type: "button", sub_type: "copy_code", index: String(index), parameters: [{ type: "coupon_code", coupon_code: content.offerCode }] });
    }
  }
  return { messaging_product: "whatsapp", type: "template", biz_opaque_callback_data: callbackId, template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) } };
}
