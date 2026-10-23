ALTER TABLE `delivery_checkouts` ADD `payment_mode` enum('cod','gateway','manual_qr') DEFAULT 'cod' NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `payment_provider` varchar(30);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `gateway_ref` varchar(100);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `gateway_payment_id` varchar(100);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `payment_status` enum('none','pending','paid','failed','refund_pending','refunded','refund_failed') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `payment_failure_reason` varchar(200);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `refund_gateway_ref` varchar(100);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `refund_status` enum('none','pending','success','failed') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD CONSTRAINT `delivery_gateway_ref_uq` UNIQUE(`payment_provider`,`gateway_ref`);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD CONSTRAINT `delivery_refund_gateway_ref_uq` UNIQUE(`payment_provider`,`refund_gateway_ref`);--> statement-breakpoint
CREATE INDEX `delivery_payment_status_idx` ON `delivery_checkouts` (`tenant_id`,`payment_status`,`created_at`);