import "server-only";
import { after } from "next/server";
import nodemailer from "nodemailer";

// Emails the platform admin when a restaurant needs them: an "I have paid" to confirm, or a
// request to unlock a feature or renew. Uses any SMTP mailbox (Hostinger mail: smtp.hostinger.com,
// port 465). Set SMTP_HOST, SMTP_USER and SMTP_PASS in the hosting panel; mail goes to ALERT_EMAIL,
// else PLATFORM_ADMIN_EMAIL. Without them nothing is sent and nothing breaks.

const env = (k: string) => process.env[k]?.trim() || null;

export const adminMailReady = () => !!(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS") && (env("ALERT_EMAIL") ?? env("PLATFORM_ADMIN_EMAIL")));

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Sends after the response, so the restaurant's screen never waits on mail */
export function emailAdmin(subject: string, lines: string[]) {
  if (!adminMailReady()) return;
  const port = Number(env("SMTP_PORT") ?? 465);
  const to = (env("ALERT_EMAIL") ?? env("PLATFORM_ADMIN_EMAIL"))!;
  const base = (env("PUBLIC_APP_URL") ?? env("NEXT_PUBLIC_APP_URL") ?? "").replace(/\/$/, "");
  const link = base ? `${base}/admin` : null;
  const send = async () => {
    const mail = nodemailer.createTransport({ host: env("SMTP_HOST")!, port, secure: port === 465, disableFileAccess: true, disableUrlAccess: true, auth: { user: env("SMTP_USER")!, pass: env("SMTP_PASS")! } });
    await mail.sendMail({
      from: `TableQR <${env("SMTP_USER")}>`,
      to,
      subject,
      text: [...lines, ...(link ? ["", `Open admin: ${link}`] : [])].join("\n"),
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${lines.map((l) => `<p style="margin:0 0 6px">${escape(l)}</p>`).join("")}${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#5b42f5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open admin</a></p>` : ""}</div>`,
    });
  };
  const run = () => send().catch((err) => console.error("[admin-alerts] email failed:", err instanceof Error ? err.message : err));
  try {
    after(run);
  } catch {
    // Outside a request (scripts, tests): send now
    void run();
  }
}
