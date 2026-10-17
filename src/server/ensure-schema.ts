import "server-only";
import type { Pool, RowDataPacket } from "mysql2/promise";

// Brings the live database up to what this release needs, once, when the server starts.
// Hostinger builds and starts the app straight from Git and never runs `db:migrate`, so these
// steps mirror drizzle/0016-0022. Every step checks first, so running it again (another server
// instance, a restart) changes nothing. Works on MySQL and MariaDB.

type Step = { tag: string; when: number; hash: string; apply: (db: Pool) => Promise<void> };

const hasColumn = async (db: Pool, table: string, column: string) => {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  return Number(rows[0]?.n ?? 0) > 0;
};

const hasTable = async (db: Pool, table: string) => {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [table]);
  return Number(rows[0]?.n ?? 0) > 0;
};

/** Adds a column unless it is there; a second server adding it at the same moment is fine */
async function addColumn(db: Pool, table: string, column: string, type: string) {
  if (await hasColumn(db, table, column)) return false;
  try {
    await db.query(`ALTER TABLE \`${table}\` ADD \`${column}\` ${type}`);
    return true;
  } catch (err) {
    if (await hasColumn(db, table, column)) return false;
    throw err;
  }
}

const STEPS: Step[] = [
  {
    tag: "0016_plan_kitchen_display",
    when: 1791741687360,
    hash: "f4972abb6248b8754faf17774c6fd8fc23a0f7176673c89764dd3ea84f50ed71",
    apply: async (db) => {
      await db.query(
        "UPDATE `plans` SET `features` = JSON_SET(`features`, '$.kitchenDisplay', IF(`code` IN ('starter', 'growth'), JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.kitchenDisplay') IS NULL",
      );
    },
  },
  {
    tag: "0017_tenant_kitchen_display",
    when: 1791742844050,
    hash: "d76ad4ea8cf6b289bdc8f2c5fbf66c2b880a8f0a41e3e389606ab0f93abf1d83",
    apply: async (db) => {
      await addColumn(db, "tenants", "kitchen_display", "boolean");
    },
  },
  {
    tag: "0018_tenant_table_limit",
    when: 1791743842715,
    hash: "92d3a7a89802634cb2871e3a7d67f18d0195b94b3f42f94aed91b4e4bc2c38da",
    apply: async (db) => {
      // Restaurants that already exist keep exactly the tables they run today as their limit
      if (await addColumn(db, "tenants", "table_limit", "int")) {
        await db.query(
          "UPDATE `tenants` t SET `table_limit` = GREATEST(1, (SELECT COUNT(*) FROM `dining_tables` d WHERE d.`tenant_id` = t.`id` AND d.`is_active` = 1)) WHERE t.`table_limit` IS NULL",
        );
      }
    },
  },
  {
    tag: "0019_staff_duty",
    when: 1791792326336,
    hash: "2043d8dcd219d46bd9ef99c13d35356ad67d38869b395cf2b9e87591ba8d8add",
    apply: async (db) => {
      await addColumn(db, "users", "duty_status", "enum('on','break','off') DEFAULT 'on' NOT NULL");
      await addColumn(db, "users", "duty_changed_at", "datetime(3)");
      await addColumn(db, "users", "last_seen_at", "datetime(3)");
    },
  },
  {
    tag: "0020_plan_features",
    when: 1792218416304,
    hash: "cf4cc5e2538e1fc07dd66f1f976ab5fa12893009a7e34d2ba7e7b5d047c0357d",
    apply: async (db) => {
      await addColumn(db, "tenants", "custom_features", "json");
      await addColumn(db, "tenants", "custom_price_paise", "int");
      // Plans saved before these switches existed: Starter gets none, Growth all but full reports
      for (const key of ["waiterApp", "discounts", "whatsappBills", "reservations"]) {
        await db.query(
          `UPDATE \`plans\` SET \`features\` = JSON_SET(\`features\`, '$.${key}', IF(\`code\` = 'starter', JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(\`features\`, '$.${key}') IS NULL`,
        );
      }
      await db.query(
        "UPDATE `plans` SET `features` = JSON_SET(`features`, '$.fullReports', IF(`code` IN ('starter', 'growth'), JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.fullReports') IS NULL",
      );
      await db.query(
        `INSERT INTO \`plans\` (\`code\`, \`name\`, \`monthly_price_paise\`, \`features\`, \`is_public\`, \`sort_order\`, \`created_at\`, \`updated_at\`) SELECT 'custom', 'Custom', NULL, '{"maxTables":5,"maxStaff":2,"poweredBy":true,"waiterApp":false,"discounts":false,"whatsappBills":false,"groupSplit":false,"reservations":false,"kitchenDisplay":false,"pricingRules":false,"fullReports":false,"multiOutlet":false}', 1, 99, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM \`plans\` WHERE \`code\` = 'custom')`,
      );
      // New plan names, only where the admin has not renamed them already
      await db.query("UPDATE `plans` SET `name` = 'Lite' WHERE `code` = 'starter' AND `name` = 'Starter'");
      await db.query("UPDATE `plans` SET `name` = 'Plus' WHERE `code` = 'growth' AND `name` = 'Growth'");
      // New table and staff limits, only where the admin has not changed the old ones
      for (const [code, oldTables, oldStaff, tables, staff] of [["starter", 15, 3, 6, 3], ["growth", 40, 10, 12, 6], ["pro", 80, 25, 20, 20]] as const) {
        await db.query(
          "UPDATE `plans` SET `features` = JSON_SET(`features`, '$.maxTables', ?, '$.maxStaff', ?) WHERE `code` = ? AND JSON_EXTRACT(`features`, '$.maxTables') = ? AND JSON_EXTRACT(`features`, '$.maxStaff') = ?",
          [tables, staff, code, oldTables, oldStaff],
        );
      }
    },
  },
  {
    tag: "0021_plan_requests",
    when: 1792221573640,
    hash: "d3a8f5aca0d594ff980a82a4428d38a35ad18689898f273c1a00fd96351a56a9",
    apply: async (db) => {
      if (await hasTable(db, "plan_requests")) return;
      await db.query(
        "CREATE TABLE IF NOT EXISTS `plan_requests` (`id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `outlet_id` char(36), `requested_by` varchar(80) NOT NULL, `feature` varchar(30), `note` varchar(300), `status` enum('open','done') NOT NULL DEFAULT 'open', `created_at` datetime(3) NOT NULL, `done_at` datetime(3), CONSTRAINT `plan_requests_id` PRIMARY KEY(`id`), CONSTRAINT `plan_requests_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`), INDEX `plan_requests_tenant_status_idx` (`tenant_id`, `status`))",
      );
    },
  },
  {
    tag: "0022_fee_payments",
    when: 1792232890499,
    hash: "fe67ace1fd5382abef26fd448fdcac8e0d4ba2b6445be4032d6666fb160c7917",
    apply: async (db) => {
      if (await hasTable(db, "fee_payments")) return;
      await db.query(
        "CREATE TABLE IF NOT EXISTS `fee_payments` (`id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `months` int NOT NULL, `amount_paise` int NOT NULL, `method` enum('upi','cash','bank') NOT NULL DEFAULT 'upi', `reference` varchar(60), `status` enum('claimed','confirmed','rejected') NOT NULL, `claimed_by` varchar(80) NOT NULL, `subscription_id` char(36), `paid_until` datetime(3), `created_at` datetime(3) NOT NULL, `decided_at` datetime(3), CONSTRAINT `fee_payments_id` PRIMARY KEY(`id`), CONSTRAINT `fee_payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`), INDEX `fee_payments_tenant_created_idx` (`tenant_id`, `created_at`), INDEX `fee_payments_status_idx` (`status`))",
      );
    },
  },
];

/** drizzle/0015, the last migration before these steps */
const BEFORE = 1791043208000;

export async function ensureSchema(db: Pool) {
  for (const step of STEPS) await step.apply(db);

  // A database kept by `drizzle-kit migrate` records what it has run; mark these steps as run too,
  // but only when it is otherwise up to date, so an older gap is never hidden
  const [tables] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'",
  );
  if (Number(tables[0]?.n ?? 0) === 0) return;
  const [last] = await db.query<RowDataPacket[]>("SELECT MAX(`created_at`) AS at FROM `__drizzle_migrations`");
  const lastAt = Number(last[0]?.at ?? 0);
  if (lastAt < BEFORE) {
    console.warn("[schema] __drizzle_migrations is behind; run `npm run db:migrate` once to catch up.");
    return;
  }
  for (const step of STEPS) {
    if (step.when > lastAt) await db.query("INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)", [step.hash, step.when]);
  }
}
