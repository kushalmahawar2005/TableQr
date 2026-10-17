// Prints the SQL that creates the plans and the first platform admin, so it can be pasted into
// phpMyAdmin when `npm run db:admin` cannot run on the host (shared hosting limits threads).
// The password is hashed here, on your own computer; only the hash goes into the SQL.
//
//   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PW='a long password' npx tsx scripts/print-admin-sql.ts
import { hashAdminPassword } from "../src/server/admin/password";
import { uuidv7 } from "../src/db/id";
import { DEFAULT_PLANS } from "../src/lib/plan-features";

const q = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim();
  const password = process.env.ADMIN_PW;
  if (!email || !name || !password) throw new Error("Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PW");

  const plans = DEFAULT_PLANS.map((p) => ({ code: p.code, name: p.name, price: p.monthlyPricePaise, sort: p.sortOrder, features: p.features }));

  const lines = plans.map(
    (p) =>
      "INSERT IGNORE INTO `plans` (`code`, `name`, `monthly_price_paise`, `features`, `sort_order`, `created_at`, `updated_at`) VALUES (" +
      [q(p.code), q(p.name), p.price ?? "NULL", q(JSON.stringify(p.features)), p.sort, "NOW(3)", "NOW(3)"].join(", ") +
      ");",
  );
  const hash = await hashAdminPassword(password);
  lines.push(
    "INSERT INTO `platform_admins` (`id`, `email`, `name`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`) VALUES (" +
      [q(uuidv7()), q(email), q(name), q(hash), "'super_admin'", "1", "NOW(3)", "NOW(3)"].join(", ") +
      ") ON DUPLICATE KEY UPDATE `password_hash` = VALUES(`password_hash`), `name` = VALUES(`name`), `role` = 'super_admin', `is_active` = 1, `updated_at` = NOW(3);",
  );
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
