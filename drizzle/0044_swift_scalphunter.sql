ALTER TABLE `delivery_checkouts` ADD `manual_payment_qr_url` varchar(500);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `manual_payment_reference` varchar(40);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `manual_payment_claimed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `manual_payment_confirmed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD CONSTRAINT `delivery_manual_reference_uq` UNIQUE(`tenant_id`,`manual_payment_reference`);--> statement-breakpoint
CREATE INDEX `delivery_manual_pending_idx` ON `delivery_checkouts` (`tenant_id`,`outlet_id`,`payment_mode`,`payment_status`,`manual_payment_claimed_at`);