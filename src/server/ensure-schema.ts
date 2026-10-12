import "server-only";
import type { Pool, RowDataPacket } from "mysql2/promise";

// Brings the live database up to what this release needs, once, when the server starts.
// Hostinger builds and starts the app straight from Git and never runs `db:migrate`, so these
// steps mirror drizzle/0016-0019. Every step checks first, so running it again (another server
// instance, a restart) changes nothing. Works on MySQL and MariaDB.

type Step = { tag: string; when: number; hash: string; apply: (db: Pool) => Promise<void> };

const hasColumn = async (db: Pool, table: string, column: string) => {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
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
