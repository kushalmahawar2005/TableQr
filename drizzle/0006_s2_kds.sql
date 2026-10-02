CREATE TABLE `kds_devices` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`station` varchar(30),
	`expeditor` boolean NOT NULL DEFAULT false,
	`lang` enum('en','hi') NOT NULL DEFAULT 'en',
	`created_by_user_id` char(36) NOT NULL,
	`updated_by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3),
	`revoked_at` datetime(3),
	CONSTRAINT `kds_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `kds_devices_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `order_lines` ADD `allergens_snapshot` json;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `is_jain_snapshot` boolean;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `spice_level_snapshot` tinyint;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `preparing_at` datetime(3);--> statement-breakpoint
ALTER TABLE `orders` ADD `preparing_at` datetime(3);--> statement-breakpoint
-- One ticket per station per order. If an older database holds duplicates this statement fails with
-- "Duplicate entry ... for key 'tickets_order_station_uq'": nothing is deleted; reconcile by hand first.
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_order_station_uq` UNIQUE(`order_id`,`station`);--> statement-breakpoint
ALTER TABLE `kds_devices` ADD CONSTRAINT `fk_kds_devices_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kds_devices` ADD CONSTRAINT `fk_kds_devices_created_by` FOREIGN KEY (`tenant_id`,`created_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kds_devices` ADD CONSTRAINT `fk_kds_devices_updated_by` FOREIGN KEY (`tenant_id`,`updated_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `kds_devices_outlet_idx` ON `kds_devices` (`tenant_id`,`outlet_id`);