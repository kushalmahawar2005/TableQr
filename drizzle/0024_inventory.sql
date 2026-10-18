CREATE TABLE `recipe_lines` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`stock_item_id` char(36) NOT NULL,
	`qty_milli` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `recipe_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `recipe_lines_item_stock_uq` UNIQUE(`outlet_id`,`item_id`,`stock_item_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_items` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`name` varchar(80) NOT NULL,
	`unit` enum('kg','g','l','ml','pcs') NOT NULL,
	`qty_milli` int NOT NULL DEFAULT 0,
	`low_milli` int,
	`cost_paise` int,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_items_outlet_name_uq` UNIQUE(`outlet_id`,`name`),
	CONSTRAINT `stock_items_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_moves` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`stock_item_id` char(36) NOT NULL,
	`kind` enum('purchase','sale','wastage','count') NOT NULL,
	`qty_milli` int NOT NULL,
	`cost_paise` int,
	`note` varchar(140),
	`bill_id` char(36),
	`by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_moves_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `recipe_lines` ADD CONSTRAINT `fk_recipe_lines_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_lines` ADD CONSTRAINT `fk_recipe_lines_item` FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_lines` ADD CONSTRAINT `fk_recipe_lines_stock` FOREIGN KEY (`tenant_id`,`stock_item_id`) REFERENCES `stock_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_items` ADD CONSTRAINT `fk_stock_items_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_item` FOREIGN KEY (`tenant_id`,`stock_item_id`) REFERENCES `stock_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_moves` ADD CONSTRAINT `fk_stock_moves_by` FOREIGN KEY (`tenant_id`,`by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `stock_moves_item_created_idx` ON `stock_moves` (`stock_item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_moves_outlet_created_idx` ON `stock_moves` (`outlet_id`,`created_at`);--> statement-breakpoint
-- Inventory comes with Pro and Chain; other plans can have it through the admin
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.inventory', IF(`code` IN ('pro', 'chain'), JSON_EXTRACT('true', '$'), JSON_EXTRACT('false', '$'))) WHERE JSON_EXTRACT(`features`, '$.inventory') IS NULL;
