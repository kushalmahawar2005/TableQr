CREATE TABLE `delivery_checkouts` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`lines` json NOT NULL,
	`address` json NOT NULL,
	`guest_id` char(36),
	`name` varchar(40),
	`phone` varchar(15),
	`verified_at` datetime(3),
	`session_id` char(36),
	`status` enum('draft','placed','dispatched','delivered','cancelled') NOT NULL DEFAULT 'draft',
	`delivery_fee_paise` int NOT NULL DEFAULT 0,
	`total_paise` int NOT NULL DEFAULT 0,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`placed_at` datetime(3),
	CONSTRAINT `delivery_checkouts_id` PRIMARY KEY(`id`),
	CONSTRAINT `delivery_checkouts_tenant_key` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `delivery_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `delivery_otp_challenges` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`checkout_id` char(36) NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expires_at` datetime(3) NOT NULL,
	`resend_at` datetime(3) NOT NULL,
	`locked_until` datetime(3),
	`verified_at` datetime(3),
	`dead_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `delivery_otp_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `delivery_fee_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `delivery_fee_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD CONSTRAINT `fk_delivery_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD CONSTRAINT `fk_delivery_guest` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD CONSTRAINT `fk_delivery_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_otp_challenges` ADD CONSTRAINT `fk_delivery_otp_checkout` FOREIGN KEY (`tenant_id`,`checkout_id`) REFERENCES `delivery_checkouts`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_otp_challenges` ADD CONSTRAINT `fk_delivery_otp_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `delivery_device_idx` ON `delivery_checkouts` (`tenant_id`,`device_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `delivery_outlet_idx` ON `delivery_checkouts` (`outlet_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `delivery_otp_phone_idx` ON `delivery_otp_challenges` (`tenant_id`,`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `delivery_otp_device_idx` ON `delivery_otp_challenges` (`tenant_id`,`device_id`,`created_at`);