CREATE TABLE `staff_push_subscriptions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`endpoint_hash` char(64) NOT NULL,
	`subscription` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `staff_push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_push_endpoint_uq` UNIQUE(`endpoint_hash`)
);
--> statement-breakpoint
ALTER TABLE `staff_push_subscriptions` ADD CONSTRAINT `fk_staff_push_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_push_subscriptions` ADD CONSTRAINT `fk_staff_push_user` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `staff_push_outlet_idx` ON `staff_push_subscriptions` (`tenant_id`,`outlet_id`);--> statement-breakpoint
CREATE INDEX `staff_push_user_idx` ON `staff_push_subscriptions` (`tenant_id`,`user_id`);