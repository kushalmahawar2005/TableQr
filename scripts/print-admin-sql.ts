// Prints the SQL that creates the plans and the first platform admin, so it can be pasted into
// phpMyAdmin when `npm run db:admin` cannot run on the host (shared hosting limits threads).
// The password is hashed here, on your own computer; only the hash goes into the SQL.
//
//   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PW='a long password' npx tsx scripts/print-admin-sql.ts
import { hashAdminPassword } from "../src/server/admin/password";
import { uuidv7 } from "../src/db/id";

const q = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim();
  const password = process.env.ADMIN_PW;
  if (!email || !name || !password) throw new Error("Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PW");

  const plans = [
    { code: "starter", name: "Starter", price: 99900, sort: 0, features: { maxTables: 15, maxStaff: 3, bookings: "reservations_only", groupSplit: false, pricingRules: false, suggestions: false, guestCampaigns: false, multiOutlet: false, poweredBy: true } },
    { code: "growth", name: "Growth", price: 249900, sort: 1, features: { maxTables: 40, maxStaff: 10, bookings: "full", groupSplit: true, pricingRules: false, suggestions: false, guestCampaigns: false, multiOutlet: false, poweredBy: true } },
    { code: "pro", name: "Pro", price: 499900, sort: 2, features: { maxTables: 80, maxStaff: 25, bookings: "full", groupSplit: true, pricingRules: true, suggestions: true, guestCampaigns: true, multiOutlet: false, poweredBy: false } },
    { code: "chain", name: "Chain", price: null, sort: 3, features: { maxTables: null, maxStaff: null, bookings: "full", groupSplit: true, pricingRules: true, suggestions: true, guestCampaigns: true, multiOutlet: true, poweredBy: false } },
  ];

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
