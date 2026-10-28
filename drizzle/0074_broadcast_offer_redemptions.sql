CREATE TABLE `broadcast_offer_redemptions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`campaign_id` char(36) NOT NULL,
	`recipient_id` char(36) NOT NULL,
	`bill_id` char(36) NOT NULL,
	`offer_code` varchar(30) NOT NULL,
	`discount_paise` int NOT NULL,
	`applied_by_user_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`reversed_at` datetime(3),
	CONSTRAINT `broadcast_offer_redemptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `broadcast_offer_redemptions_guest_uq` UNIQUE(`tenant_id`,`campaign_id`,`recipient_id`)
);
--> statement-breakpoint
ALTER TABLE `broadcast_offer_redemptions` ADD CONSTRAINT `fk_broadcast_offer_redemptions_campaign` FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `broadcast_campaigns`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_recipients_tenant_key` ON `broadcast_recipients` (`tenant_id`,`id`);--> statement-breakpoint
ALTER TABLE `broadcast_offer_redemptions` ADD CONSTRAINT `fk_broadcast_offer_redemptions_recipient` FOREIGN KEY (`tenant_id`,`recipient_id`) REFERENCES `broadcast_recipients`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `broadcast_offer_redemptions` ADD CONSTRAINT `fk_broadcast_offer_redemptions_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `broadcast_offer_redemptions` ADD CONSTRAINT `fk_broadcast_offer_redemptions_user` FOREIGN KEY (`tenant_id`,`applied_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `broadcast_offer_redemptions_campaign_idx` ON `broadcast_offer_redemptions` (`tenant_id`,`campaign_id`,`created_at`);
