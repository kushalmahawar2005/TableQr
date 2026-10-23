import "server-only";
import type { Pool, RowDataPacket } from "mysql2/promise";

// Brings the live database up to what this release needs, once, when the server starts.
// Hostinger builds and starts the app straight from Git and never runs `db:migrate`, so these
// steps mirror drizzle/0016-0032. Every step checks first, so running it again (another server
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

const hasIndex = async (db: Pool, table: string, index: string) => {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [table, index],
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

async function addUniqueIndex(db: Pool, table: string, index: string, columns: string) {
  if (await hasIndex(db, table, index)) return;
  try {
    await db.query(`CREATE UNIQUE INDEX \`${index}\` ON \`${table}\` (${columns})`);
  } catch (err) {
    if (await hasIndex(db, table, index)) return;
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
  {
    tag: "0023_fee_plan",
    when: 1792235439635,
    hash: "3c5d9abc10da754e73fb16c033c06492a8497f1d6fe7168f2c1b1be8355b28de",
    apply: async (db) => {
      await addColumn(db, "fee_payments", "plan_code", "varchar(20)");
    },
  },
  {
    tag: "0024_inventory",
    when: 1792239186472,
    hash: "5aab46329374e258e6c3d73c45bec2787753b1b30e85d87f7ef74f59f65c738d",
    apply: async (db) => {
      // The three tables arrive together; their keys and indexes only on the start that made them
      if (!(await hasTable(db, "stock_items"))) {
        for (const q of [
        "CREATE TABLE IF NOT EXISTS `recipe_lines` ( `id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `outlet_id` char(36) NOT NULL, `item_id` char(36) NOT NULL, `stock_item_id` char(36) NOT NULL, `qty_milli` int NOT NULL, `created_at` datetime(3) NOT NULL, CONSTRAINT `recipe_lines_id` PRIMARY KEY(`id`), CONSTRAINT `recipe_lines_item_stock_uq` UNIQUE(`outlet_id`,`item_id`,`stock_item_id`) )",
        "CREATE TABLE IF NOT EXISTS `stock_items` ( `id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `outlet_id` char(36) NOT NULL, `name` varchar(80) NOT NULL, `unit` enum('kg','g','l','ml','pcs') NOT NULL, `qty_milli` int NOT NULL DEFAULT 0, `low_milli` int, `cost_paise` int, `is_active` boolean NOT NULL DEFAULT true, `created_at` datetime(3) NOT NULL, `updated_at` datetime(3) NOT NULL, CONSTRAINT `stock_items_id` PRIMARY KEY(`id`), CONSTRAINT `stock_items_outlet_name_uq` UNIQUE(`outlet_id`,`name`), CONSTRAINT `stock_items_tenant_key` UNIQUE(`tenant_id`,`id`) )",
        "CREATE TABLE IF NOT EXISTS `stock_moves` ( `id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `outlet_id` char(36) NOT NULL, `stock_item_id` char(36) NOT NULL, `kind` enum('purchase','sale','wastage','count') NOT NULL, `qty_milli` int NOT NULL, `cost_paise` int, `note` varchar(140), `bill_id` char(36), `by_user_id` char(36), `created_at` datetime(3) NOT NULL, CONSTRAINT `stock_moves_id` PRIMARY KEY(`id`) )",
      ]) await db.query(q);
        for (const q of [
        "ALTER TABLE `recipe_lines` ADD CONSTRAINT `fk_recipe_lines_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `recipe_lines` ADD CONSTRAINT `fk_recipe_lines_item` FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `recipe_lines` ADD CONSTRAINT `fk_recipe_lines_stock` FOREIGN KEY (`tenant_id`,`stock_item_id`) REFERENCES `stock_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `stock_items` ADD CONSTRAINT `fk_stock_items_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_item` FOREIGN KEY (`tenant_id`,`stock_item_id`) REFERENCES `stock_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_by` FOREIGN KEY (`tenant_id`,`by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "CREATE INDEX `stock_moves_item_created_idx` ON `stock_moves` (`stock_item_id`,`created_at`)",
        "CREATE INDEX `stock_moves_outlet_created_idx` ON `stock_moves` (`outlet_id`,`created_at`)",
      ]) await db.query(q);
      }
      await db.query("UPDATE `plans` SET `features` = JSON_SET(`features`, '$.inventory', IF(`code` IN ('pro', 'chain'), JSON_EXTRACT('true', '$'), JSON_EXTRACT('false', '$'))) WHERE JSON_EXTRACT(`features`, '$.inventory') IS NULL");
    },
  },
  {
    tag: "0025_rooms",
    when: 1792255107041,
    hash: "86612d0705b9bca83f4d96da9e921ee1b43936ac35738f29590b7b0a630998fc",
    apply: async (db) => {
      // Rooms, stays and room requests arrive together; their keys and indexes only on the start that made them
      if (!(await hasTable(db, "rooms"))) {
        for (const q of [
        "CREATE TABLE IF NOT EXISTS `room_requests` ( `id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `outlet_id` char(36) NOT NULL, `room_id` char(36) NOT NULL, `stay_id` char(36) NOT NULL, `kind` enum('housekeeping','towels','water','toiletries','laundry','maintenance','wake_up','other') NOT NULL, `note` varchar(140), `status` enum('open','done') NOT NULL DEFAULT 'open', `created_at` datetime(3) NOT NULL, `done_at` datetime(3), `done_by_user_id` char(36), CONSTRAINT `room_requests_id` PRIMARY KEY(`id`) )",
        "CREATE TABLE IF NOT EXISTS `room_stays` ( `id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `outlet_id` char(36) NOT NULL, `room_id` char(36) NOT NULL, `guest_name` varchar(80) NOT NULL, `guest_phone` varchar(15), `guests` int NOT NULL DEFAULT 1, `food_pay` enum('at_checkout','per_order') NOT NULL DEFAULT 'at_checkout', `note` varchar(140), `status` enum('open','closed') NOT NULL DEFAULT 'open', `open_key` char(36), `check_in_at` datetime(3) NOT NULL, `expected_check_out_at` datetime(3), `check_out_at` datetime(3), `checked_in_by_user_id` char(36), `checked_out_by_user_id` char(36), `created_at` datetime(3) NOT NULL, CONSTRAINT `room_stays_id` PRIMARY KEY(`id`), CONSTRAINT `room_stays_open_uq` UNIQUE(`open_key`), CONSTRAINT `room_stays_tenant_key` UNIQUE(`tenant_id`,`id`) )",
        "CREATE TABLE IF NOT EXISTS `rooms` ( `id` char(36) NOT NULL, `tenant_id` char(36) NOT NULL, `outlet_id` char(36) NOT NULL, `number` varchar(7) NOT NULL, `room_type` varchar(40), `floor_label` varchar(40), `table_id` char(36) NOT NULL, `status` enum('vacant','occupied','cleaning','blocked') NOT NULL DEFAULT 'vacant', `is_active` boolean NOT NULL DEFAULT true, `created_at` datetime(3) NOT NULL, `updated_at` datetime(3) NOT NULL, CONSTRAINT `rooms_id` PRIMARY KEY(`id`), CONSTRAINT `rooms_outlet_number_uq` UNIQUE(`outlet_id`,`number`), CONSTRAINT `rooms_table_uq` UNIQUE(`table_id`), CONSTRAINT `rooms_tenant_key` UNIQUE(`tenant_id`,`id`) )",
      ]) await db.query(q);
        for (const q of [
        "ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_room` FOREIGN KEY (`tenant_id`,`room_id`) REFERENCES `rooms`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_stay` FOREIGN KEY (`tenant_id`,`stay_id`) REFERENCES `room_stays`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_done_by` FOREIGN KEY (`tenant_id`,`done_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_room` FOREIGN KEY (`tenant_id`,`room_id`) REFERENCES `rooms`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_in_by` FOREIGN KEY (`tenant_id`,`checked_in_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_out_by` FOREIGN KEY (`tenant_id`,`checked_out_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `rooms` ADD CONSTRAINT `fk_rooms_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "ALTER TABLE `rooms` ADD CONSTRAINT `fk_rooms_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action",
        "CREATE INDEX `room_requests_outlet_status_idx` ON `room_requests` (`outlet_id`,`status`)",
        "CREATE INDEX `room_requests_stay_idx` ON `room_requests` (`stay_id`,`created_at`)",
        "CREATE INDEX `room_stays_outlet_idx` ON `room_stays` (`outlet_id`,`check_in_at`)",
      ]) await db.query(q);
      }
      // The Reception role
      const [role] = await db.query<RowDataPacket[]>("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_roles' AND COLUMN_NAME = 'role'");
      if (!String(role[0]?.t ?? "").includes("'reception'")) await db.query("ALTER TABLE `staff_roles` MODIFY COLUMN `role` enum('owner','manager','cashier','host','waiter','kitchen','accountant','reception') NOT NULL");
      await db.query("UPDATE `plans` SET `features` = JSON_SET(`features`, '$.dineIn', JSON_EXTRACT('true', '$')) WHERE JSON_EXTRACT(`features`, '$.dineIn') IS NULL");
      await db.query("UPDATE `plans` SET `features` = JSON_SET(`features`, '$.rooms', JSON_EXTRACT('false', '$')) WHERE JSON_EXTRACT(`features`, '$.rooms') IS NULL");
      await db.query("INSERT INTO `plans` (`code`, `name`, `monthly_price_paise`, `features`, `is_public`, `sort_order`, `created_at`, `updated_at`) SELECT 'hotel', 'Hotel', 299900, '{\"dineIn\":false,\"rooms\":true,\"waiterApp\":false,\"discounts\":true,\"whatsappBills\":true,\"groupSplit\":false,\"reservations\":false,\"kitchenDisplay\":true,\"pricingRules\":false,\"fullReports\":true,\"multiOutlet\":false,\"inventory\":false,\"maxTables\":null,\"maxStaff\":10,\"maxRooms\":30,\"poweredBy\":false}', 1, 4, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `plans` WHERE `code` = 'hotel')");
      await db.query("INSERT INTO `plans` (`code`, `name`, `monthly_price_paise`, `features`, `is_public`, `sort_order`, `created_at`, `updated_at`) SELECT 'hotel_plus', 'Hotel + Restaurant', 699900, '{\"dineIn\":true,\"rooms\":true,\"waiterApp\":true,\"discounts\":true,\"whatsappBills\":true,\"groupSplit\":true,\"reservations\":true,\"kitchenDisplay\":true,\"pricingRules\":true,\"fullReports\":true,\"multiOutlet\":false,\"inventory\":true,\"maxTables\":20,\"maxStaff\":25,\"maxRooms\":30,\"poweredBy\":false}', 1, 5, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `plans` WHERE `code` = 'hotel_plus')");
    },
  },
  {
    tag: "0026_counter_items",
    when: 1792564802690,
    hash: "b5191ed05540cf4f68846d080cac1467549cbdd29e64a26d1ff7be8d94275b8c",
    apply: async (db) => {
      await addColumn(db, "orders", "at_counter", "boolean DEFAULT false NOT NULL");
    },
  },
  {
    tag: "0027_user_guide",
    when: 1792567360613,
    hash: "92decc3eff21aa11eb8a5efa96b3d1a56387b8d640622378b802b03de5199733",
    apply: async (db) => {
      await addColumn(db, "users", "guide", "json");
    },
  },
  {
    tag: "0028_early_santa_claus",
    when: 1792582575582,
    hash: "8ad41d93e5fb71ee118baac2f1ea8e3f4107ff97abfcce879c133e802a79b23a",
    apply: async (db) => {
      const [method] = await db.query<RowDataPacket[]>("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_payments' AND COLUMN_NAME = 'method'");
      if (!String(method[0]?.t ?? "").includes("'cashfree'")) {
        await db.query("ALTER TABLE `fee_payments` MODIFY COLUMN `method` enum('cashfree','upi','cash','bank') NOT NULL DEFAULT 'cashfree'");
      }
      await addColumn(db, "fee_payments", "client_request_id", "varchar(64)");
      await addColumn(db, "fee_payments", "gateway_ref", "varchar(100)");
      await addColumn(db, "fee_payments", "gateway_payment_id", "varchar(100)");
      await addColumn(db, "fee_payments", "failure_reason", "varchar(200)");
      await addColumn(db, "fee_payments", "checked_at", "datetime(3)");
      await addUniqueIndex(db, "fee_payments", "fee_payments_request_uq", "`tenant_id`,`client_request_id`");
      await addUniqueIndex(db, "fee_payments", "fee_payments_gateway_ref_uq", "`gateway_ref`");
    },
  },
  {
    tag: "0029_reservation_advance", when: 1792696666093, hash: "6a0151571dac954aaf22318f8a12f539a8501978f9401c3a4f7080914b3a094e",
    apply: async (db) => {
      await addColumn(db, "reservations", "advance_received_paise", "int DEFAULT 0 NOT NULL");
    },
  },
  {
    tag: "0030_fantastic_karma", when: 1792738560008, hash: "639d825ce0d151de6cbb33d9b4d20089a8614fc3765c0163e3d0c93f79ad8d26",
    apply: async (db) => {
      await db.query("CREATE TABLE IF NOT EXISTS `staff_push_subscriptions` (\n\t`id` char(36) NOT NULL,\n\t`tenant_id` char(36) NOT NULL,\n\t`outlet_id` char(36) NOT NULL,\n\t`user_id` char(36) NOT NULL,\n\t`endpoint_hash` char(64) NOT NULL,\n\t`subscription` json NOT NULL,\n\t`created_at` datetime(3) NOT NULL,\n\t`updated_at` datetime(3) NOT NULL,\n\tCONSTRAINT `staff_push_subscriptions_id` PRIMARY KEY(`id`),\n\tCONSTRAINT `staff_push_endpoint_uq` UNIQUE(`endpoint_hash`)\n, CONSTRAINT `fk_staff_push_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`), CONSTRAINT `fk_staff_push_user` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`), INDEX `staff_push_outlet_idx` (`tenant_id`,`outlet_id`), INDEX `staff_push_user_idx` (`tenant_id`,`user_id`))");
    },
  },
  {
    tag: "0031_visit_waiter", when: 1792746387567, hash: "30b1ae38b1c1c2ef70914afb7eb2ea85681e272242b83cc61fcc4ad5a89cf197",
    apply: async (db) => {
      const added = await addColumn(db, "table_sessions", "waiter_user_id", "char(36)");
      const [keys] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'table_sessions' AND CONSTRAINT_NAME = 'fk_sessions_waiter'");
      if (!Number(keys[0]?.n ?? 0)) {
        try { await db.query("ALTER TABLE `table_sessions` ADD CONSTRAINT `fk_sessions_waiter` FOREIGN KEY (`tenant_id`,`waiter_user_id`) REFERENCES `users`(`tenant_id`,`id`)"); }
        catch (error) {
          const [existing] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_sessions_waiter'");
          if (!Number(existing[0]?.n ?? 0)) throw error;
        }
      }
      if (added) await db.query("UPDATE `table_sessions` v INNER JOIN `waiter_table_assignments` a ON a.`tenant_id` = v.`tenant_id` AND a.`outlet_id` = v.`outlet_id` AND a.`table_id` = v.`table_id` SET v.`waiter_user_id` = a.`waiter_user_id` WHERE v.`status` <> 'closed' AND v.`waiter_user_id` IS NULL AND a.`active` = 1 AND a.`expires_at` > UTC_TIMESTAMP(3)");
    },
  },
  {
    tag: "0032_pickup_item", when: 1792755686717, hash: "4197e467eb2cb4fe214125f80c133d7e3f44d25b09098a79d2df014dd3f8d03d",
    apply: async (db) => {
      await addColumn(db, "cart_lines", "personal_for_pickup", "boolean DEFAULT false NOT NULL");
      await addColumn(db, "order_lines", "personal_for_pickup", "boolean DEFAULT false NOT NULL");
    },
  },
  {
    tag: "0033_purple_matthew_murdock", when: 1792758608042, hash: "5ea8327e89467fb21011c57bfe2e3baa097f3230db2b89403ac00fe0e3014768",
    apply: async (db) => {
      await addColumn(db, "outlets", "room_services", "json");
      await addColumn(db, "outlets", "wifi_ssid", "varchar(32)");
      await addColumn(db, "outlets", "wifi_password", "varchar(63)");
    },
  },
  {
    tag: "0034_repeat_order_modifier_choices", when: 1792759015664, hash: "905277e364bfc0450e726bbec67df22e94e5641fc8a5041698a629b0d56dc630",
    apply: async (db) => {
      await addColumn(db, "order_lines", "modifier_choices", "json");
    },
  },
  {
    tag: "0035_reservation_preorders", when: 1792765219852, hash: "8779d72d5e11fb9ba229f3a644baf0dba1cc9c0bd2f67d8fdb2127bf3bb98082",
    apply: async (db) => {
      await addColumn(db, "reservations", "preorder", "json");
    },
  },
  {
    tag: "0036_woozy_wallow", when: 1792769103935, hash: "91bdbcff19c0cfa35aec84f73cbd54a7beab78dcda31ad5cd3688df4881ac908",
    apply: async (db) => {
      await addColumn(db, "outlets", "guest_online_payments", "boolean DEFAULT true NOT NULL");
    },
  },
  {
    tag: "0037_cuddly_absorbing_man", when: 1792770402777, hash: "5929121a8ef1d68bea2db0d4c5c4a3b3561f001bf0235ea4bf3220529582494a",
    apply: async (db) => {
      await addColumn(db, "outlets", "guest_services", "json");
    },
  },
  {
    tag: "0038_true_morg", when: 1792771676818, hash: "7d3da9aac2941e308e5484f38b836ac8ba2e3505664e90aecab2719f69d606c0",
    apply: async (db) => {
      await addColumn(db, "outlets", "booking_payment_mode", "enum('gateway','manual_qr') DEFAULT 'gateway' NOT NULL");
      await addColumn(db, "outlets", "booking_payment_qr_url", "varchar(500)");
      await addColumn(db, "reservations", "manual_advance_reference", "varchar(40)");
      await addColumn(db, "reservations", "manual_advance_claimed_at", "datetime(3)");
      await addColumn(db, "reservations", "manual_advance_confirmed_at", "datetime(3)");
      await addColumn(db, "reservations", "advance_payment_mode", "enum('gateway','manual_qr') DEFAULT 'gateway' NOT NULL");
      await addColumn(db, "reservations", "advance_payment_qr_url", "varchar(500)");
      await addColumn(db, "reservations", "booking_device_id", "varchar(64)");
    },
  },
  {
    tag: "0039_modern_hedge_knight", when: 1792774386962, hash: "6c3926b3ec4559e4a0ab5ea3dff96a9354f879809d0192ccf2ba503596a18e9a",
    apply: async (db) => {
      await addColumn(db, "outlets", "delivery_policy", "json");
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
