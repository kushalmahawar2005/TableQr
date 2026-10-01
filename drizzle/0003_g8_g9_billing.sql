CREATE TABLE `receipt_deliveries` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`bill_id` char(36) NOT NULL,
	`participant_id` char(36),
	`channel` enum('whatsapp','sms','email') NOT NULL,
	`destination` varchar(120) NOT NULL,
	`status` enum('queued','sent','failed') NOT NULL DEFAULT 'queued',
	`provider_ref` varchar(100),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `receipt_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `service_requests` MODIFY COLUMN `kind` enum('water','cutlery','call_waiter','clean_table','request_bill','pay_at_counter') NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `service_charge_bp` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `tip_presets_bp` json;--> statement-breakpoint
ALTER TABLE `outlets` ADD `review_url` varchar(500);--> statement-breakpoint
ALTER TABLE `bill_shares` ADD `frozen_at` datetime(3);--> statement-breakpoint
ALTER TABLE `bills` ADD `service_charge_bp` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `service_charge_waived` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `assignments` json;--> statement-breakpoint
ALTER TABLE `bills` ADD `reopened_at` datetime(3);--> statement-breakpoint
ALTER TABLE `feedback` ADD `needs_recovery` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `recovered_at` datetime(3);--> statement-breakpoint
ALTER TABLE `payments` ADD `client_request_id` varchar(64);--> statement-breakpoint
ALTER TABLE `payments` ADD `gateway_payment_id` varchar(100);--> statement-breakpoint
ALTER TABLE `payments` ADD `checked_at` datetime(3);--> statement-breakpoint
ALTER TABLE `refunds` ADD `share_id` char(36);--> statement-breakpoint
ALTER TABLE `refunds` ADD `completed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_session_participant_uq` UNIQUE(`session_id`,`participant_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_request_uq` UNIQUE(`tenant_id`,`bill_id`,`client_request_id`);--> statement-breakpoint
ALTER TABLE `receipt_deliveries` ADD CONSTRAINT `fk_receipt_deliveries_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_deliveries` ADD CONSTRAINT `fk_receipt_deliveries_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_deliveries` ADD CONSTRAINT `fk_receipt_deliveries_participant` FOREIGN KEY (`tenant_id`,`participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `receipt_deliveries_bill_idx` ON `receipt_deliveries` (`tenant_id`,`bill_id`);--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_share` FOREIGN KEY (`tenant_id`,`share_id`) REFERENCES `bill_shares`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `refunds_payment_idx` ON `refunds` (`tenant_id`,`payment_id`);