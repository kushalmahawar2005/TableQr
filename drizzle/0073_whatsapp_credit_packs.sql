CREATE TABLE `message_credit_pricing` (
	`id` char(20) NOT NULL,
	`price_per_credit_paise` int NOT NULL,
	`pack_sizes` json NOT NULL,
	`low_balance_threshold` int NOT NULL DEFAULT 20,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `message_credit_pricing_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_credit_purchases` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`credits` int NOT NULL,
	`amount_paise` int NOT NULL,
	`status` enum('claimed','confirmed','rejected') NOT NULL DEFAULT 'claimed',
	`request_id` varchar(64) NOT NULL,
	`gateway_ref` varchar(100),
	`gateway_payment_id` varchar(100),
	`failure_reason` varchar(200),
	`created_at` datetime(3) NOT NULL,
	`settled_at` datetime(3),
	CONSTRAINT `message_credit_purchases_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_credit_purchases_request_uq` UNIQUE(`tenant_id`,`request_id`),
	CONSTRAINT `message_credit_purchases_gateway_uq` UNIQUE(`gateway_ref`),
	CONSTRAINT `message_credit_purchases_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `message_credit_purchases` ADD CONSTRAINT `message_credit_purchases_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `message_credit_purchases_tenant_created_idx` ON `message_credit_purchases` (`tenant_id`,`created_at`);