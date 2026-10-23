import { loadEnvConfig } from "@next/env";
import mysql from "mysql2/promise";
import { dbConfig } from "../src/db/config";

loadEnvConfig(process.cwd());

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

function decodeBase64Url(value: string) {
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

async function checkDatabaseMigration() {
  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection({ ...dbConfig(), connectTimeout: 10_000 });
    const [tableResult] = await connection.query("SHOW TABLES LIKE ?", ["__drizzle_migrations"]);
    const tables = tableResult as unknown as unknown[];
    if (!tables.length) {
      add("Database migrations", false, "Drizzle migration journal is missing.");
      return;
    }
    const journal = await import("../drizzle/meta/_journal.json");
    const expected = journal.default.entries.at(-1);
    const [rows] = await connection.query("SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM __drizzle_migrations");
    const row = (rows as unknown as { count: number; latest: number | null }[])[0];
    const [rateLimitResult] = await connection.query("SHOW TABLES LIKE ?", ["platform_admin_login_buckets"]);
    const rateLimitTable = rateLimitResult as unknown as unknown[];
    const current = Number(row.latest) === expected?.when && Number(row.count) >= journal.default.entries.length;
    add(
      "Database migrations",
      current && rateLimitTable.length > 0,
      current && rateLimitTable.length > 0
        ? `All ${journal.default.entries.length} migrations are applied, including platform admin login throttling.`
        : "The deployed database is behind the repository migrations; apply migrations before deploying this build.",
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    add("Database migrations", false, `Could not verify the configured database (${code ?? "connection error"}).`);
  } finally {
    await connection?.end().catch(() => undefined);
  }
}

async function main() {
  const production = process.env.NODE_ENV === "production";
  const otpSecret = process.env.OTP_SECRET?.trim() ?? "";
  add("OTP signing secret", otpSecret.length >= 32, otpSecret.length >= 32 ? "Present with at least 32 characters." : "Set a stable OTP_SECRET with at least 32 random characters.");

  const publicKey = decodeBase64Url(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "");
  const privateKey = decodeBase64Url(process.env.VAPID_PRIVATE_KEY?.trim() ?? "");
  const subject = process.env.VAPID_SUBJECT?.trim() ?? "";
  let validSubject = false;
  try {
    const url = new URL(subject);
    validSubject = url.protocol === "mailto:" || url.protocol === "https:";
  } catch {
    validSubject = false;
  }
  const validPair = publicKey.length === 65 && publicKey[0] === 4 && privateKey.length === 32 && validSubject;
  add("Staff push VAPID keys", validPair, validPair ? "Public/private key formats and contact subject are valid." : "Set a matching VAPID public/private key pair and a mailto: or HTTPS VAPID subject.");

  const provider = process.env.SMS_PROVIDER?.trim().toLowerCase() ?? "";
  const apiKey = process.env.FAST2SMS_API_KEY?.trim() ?? "";
  const templateId = process.env.FAST2SMS_OTP_TEMPLATE_ID?.trim() ?? "";
  const expiry = Number(process.env.FAST2SMS_OTP_EXPIRY_MINUTES || 5);
  const smsReady = provider === "fast2sms" && !!apiKey && /^\d{4,20}$/.test(templateId) && Number.isInteger(expiry) && expiry >= 1 && expiry <= 10080;
  add("OTP SMS provider", smsReady, smsReady ? "Fast2SMS OTP endpoint and approved template are configured." : "Set SMS_PROVIDER=fast2sms, the API key, and the approved OTP template ID after DLT approval.");

  add("Production demo OTP", true, production ? "Disabled; production never returns a demo code." : "Development mode only; demo codes are never exposed from production.");
  await checkDatabaseMigration();

  for (const check of checks) console.log(`${check.ok ? "PASS" : "NEEDS ACTION"}  ${check.name}: ${check.detail}`);
  if (checks.some(check => !check.ok)) process.exitCode = 1;
}

void main();
