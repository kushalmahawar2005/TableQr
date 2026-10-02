CREATE TABLE IF NOT EXISTS `menu_item_pairings` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`source_item_id` char(36) NOT NULL,
	`paired_item_id` char(36) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `menu_item_pairings_id` PRIMARY KEY(`id`),
	CONSTRAINT `menu_item_pairings_uq` UNIQUE(`tenant_id`,`source_item_id`,`paired_item_id`)
);
--> statement-breakpoint
SET @tq_o3_col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'menu_categories' AND column_name = 'is_active');
--> statement-breakpoint
SET @tq_o3_sql := IF(@tq_o3_col_exists = 0, 'ALTER TABLE menu_categories ADD is_active boolean NOT NULL DEFAULT true', 'SELECT 1');
--> statement-breakpoint
PREPARE tq_o3_stmt FROM @tq_o3_sql;
--> statement-breakpoint
EXECUTE tq_o3_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tq_o3_stmt;
