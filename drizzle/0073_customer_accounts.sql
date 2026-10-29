CREATE TABLE `customer_challenges` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`device_hash` char(64) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `customer_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_profiles` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`guest_id` char(36) NOT NULL,
	`addresses` json NOT NULL,
	CONSTRAINT `customer_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_profiles_tenant_key` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `customer_profile_guest_uq` UNIQUE(`tenant_id`,`guest_id`)
);
--> statement-breakpoint
CREATE TABLE `customer_sessions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`guest_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `customer_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_session_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `customer_challenges` ADD CONSTRAINT `customer_otp_outlet_fk` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_profiles` ADD CONSTRAINT `customer_profile_guest_fk` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_sessions` ADD CONSTRAINT `customer_session_guest_fk` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `customer_otp_phone_idx` ON `customer_challenges` (`tenant_id`,`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_otp_device_idx` ON `customer_challenges` (`tenant_id`,`device_hash`,`created_at`);