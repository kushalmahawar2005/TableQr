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
ALTER TABLE `menu_item_pairings` ADD CONSTRAINT `fk_pairings_source` FOREIGN KEY (`tenant_id`,`source_item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `menu_item_pairings` ADD CONSTRAINT `fk_pairings_paired` FOREIGN KEY (`tenant_id`,`paired_item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;
