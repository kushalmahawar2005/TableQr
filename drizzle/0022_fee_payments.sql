CREATE TABLE `fee_payments` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`months` int NOT NULL,
	`amount_paise` int NOT NULL,
	`method` enum('upi','cash','bank') NOT NULL DEFAULT 'upi',
	`reference` varchar(60),
	`status` enum('claimed','confirmed','rejected') NOT NULL,
	`claimed_by` varchar(80) NOT NULL,
	`subscription_id` char(36),
	`paid_until` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`decided_at` datetime(3),
	CONSTRAINT `fee_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `fee_payments` ADD CONSTRAINT `fee_payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `fee_payments_tenant_created_idx` ON `fee_payments` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `fee_payments_status_idx` ON `fee_payments` (`status`);