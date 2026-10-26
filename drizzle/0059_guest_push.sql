CREATE TABLE `guest_push_subscriptions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`endpoint_hash` char(64) NOT NULL,
	`endpoint` varchar(2048) NOT NULL,
	`p256dh` varchar(256) NOT NULL,
	`auth` varchar(256) NOT NULL,
	`delivery_checkout_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `guest_push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_push_endpoint_uq` UNIQUE(`tenant_id`,`endpoint_hash`),
	CONSTRAINT `guest_push_subscriptions_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `guest_push_subscriptions` ADD CONSTRAINT `fk_guest_push_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `guest_push_checkout_idx` ON `guest_push_subscriptions` (`tenant_id`,`delivery_checkout_id`);