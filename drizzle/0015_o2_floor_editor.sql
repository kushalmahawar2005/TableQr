CREATE TABLE `floor_layout_combinations` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`version_id` char(36) NOT NULL,
	`table_id` char(36) NOT NULL,
	`combined_table_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `floor_layout_combinations_id` PRIMARY KEY(`id`),
	CONSTRAINT `floor_layout_combinations_pair_uq` UNIQUE(`tenant_id`,`version_id`,`table_id`,`combined_table_id`),
	CONSTRAINT `floor_layout_combinations_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `floor_layout_tables` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`version_id` char(36) NOT NULL,
	`logical_table_id` char(36),
	`logical_zone_id` char(36),
	`code` varchar(12) NOT NULL,
	`min_seats` int NOT NULL DEFAULT 1,
	`max_seats` int NOT NULL,
	`table_class` varchar(20) NOT NULL,
	`shape` enum('square','round','long') NOT NULL DEFAULT 'square',
	`pos_x` int NOT NULL DEFAULT 0,
	`pos_y` int NOT NULL DEFAULT 0,
	`width` int NOT NULL DEFAULT 2,
	`height` int NOT NULL DEFAULT 2,
	`is_bookable_online` boolean NOT NULL DEFAULT true,
	`archived` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `floor_layout_tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `floor_layout_tables_version_code_uq` UNIQUE(`tenant_id`,`version_id`,`code`),
	CONSTRAINT `floor_layout_tables_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `floor_layout_versions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`version_number` int NOT NULL,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
	`draft_key` varchar(12),
	`revision` int NOT NULL DEFAULT 0,
	`created_by` char(36) NOT NULL,
	`published_by` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`published_at` datetime(3),
	CONSTRAINT `floor_layout_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `floor_layout_versions_outlet_version_uq` UNIQUE(`tenant_id`,`outlet_id`,`version_number`),
	CONSTRAINT `floor_layout_versions_draft_uq` UNIQUE(`tenant_id`,`outlet_id`,`draft_key`),
	CONSTRAINT `floor_layout_versions_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `floor_layout_zones` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`version_id` char(36) NOT NULL,
	`logical_zone_id` char(36),
	`name` varchar(60) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`pos_x` int NOT NULL DEFAULT 0,
	`pos_y` int NOT NULL DEFAULT 0,
	`width` int NOT NULL DEFAULT 12,
	`height` int NOT NULL DEFAULT 8,
	`archived` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `floor_layout_zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `floor_layout_zones_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `is_active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `zones` ADD `is_active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `floor_layout_combinations` ADD CONSTRAINT `fk_floor_layout_combinations_version` FOREIGN KEY (`tenant_id`,`version_id`) REFERENCES `floor_layout_versions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_combinations` ADD CONSTRAINT `fk_floor_layout_combinations_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `floor_layout_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_combinations` ADD CONSTRAINT `fk_floor_layout_combinations_combined` FOREIGN KEY (`tenant_id`,`combined_table_id`) REFERENCES `floor_layout_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_tables` ADD CONSTRAINT `fk_floor_layout_tables_version` FOREIGN KEY (`tenant_id`,`version_id`) REFERENCES `floor_layout_versions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_tables` ADD CONSTRAINT `fk_floor_layout_tables_zone` FOREIGN KEY (`tenant_id`,`logical_zone_id`) REFERENCES `floor_layout_zones`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_versions` ADD CONSTRAINT `fk_floor_layout_versions_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_versions` ADD CONSTRAINT `fk_floor_layout_versions_created_by` FOREIGN KEY (`tenant_id`,`created_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_versions` ADD CONSTRAINT `fk_floor_layout_versions_published_by` FOREIGN KEY (`tenant_id`,`published_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `floor_layout_zones` ADD CONSTRAINT `fk_floor_layout_zones_version` FOREIGN KEY (`tenant_id`,`version_id`) REFERENCES `floor_layout_versions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `floor_layout_combinations_version_idx` ON `floor_layout_combinations` (`tenant_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `floor_layout_tables_version_idx` ON `floor_layout_tables` (`tenant_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `floor_layout_versions_outlet_idx` ON `floor_layout_versions` (`tenant_id`,`outlet_id`,`status`);--> statement-breakpoint
CREATE INDEX `floor_layout_zones_version_idx` ON `floor_layout_zones` (`tenant_id`,`version_id`,`sort_order`);