ALTER TABLE `delivery_checkouts` MODIFY COLUMN `address` json;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` MODIFY COLUMN `status` enum('draft','placed','dispatched','delivered','collected','cancelled') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `service_mode` enum('delivery','pickup') DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `collected_at` datetime(3);