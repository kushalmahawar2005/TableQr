CREATE TABLE `prep_lines` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`prep_item_id` char(36) NOT NULL,
	`stock_item_id` char(36) NOT NULL,
	`qty_milli` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `prep_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `prep_lines_item_stock_uq` UNIQUE(`outlet_id`,`prep_item_id`,`stock_item_id`)
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`supplier_id` char(36),
	`kind` enum('purchase','return') NOT NULL DEFAULT 'purchase',
	`bill_no` varchar(40),
	`bill_date` varchar(10) NOT NULL,
	`total_paise` int NOT NULL,
	`note` varchar(140),
	`by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `purchases_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchases_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`supplier_id` char(36) NOT NULL,
	`purchase_id` char(36),
	`amount_paise` int NOT NULL,
	`method` enum('cash','upi','bank','card','cheque') NOT NULL,
	`note` varchar(140),
	`paid_on` varchar(10) NOT NULL,
	`by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `supplier_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`name` varchar(80) NOT NULL,
	`phone` varchar(16),
	`gstin` varchar(15),
	`note` varchar(140),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_outlet_name_uq` UNIQUE(`outlet_id`,`name`),
	CONSTRAINT `suppliers_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `stock_moves` MODIFY COLUMN `kind` enum('purchase','sale','wastage','count','return','prep') NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `stock_sold_out` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `outlet_item_overrides` ADD `sold_out_by_stock` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `category` varchar(40);--> statement-breakpoint
ALTER TABLE `stock_items` ADD `pack_name` varchar(20);--> statement-breakpoint
ALTER TABLE `stock_items` ADD `pack_milli` int;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `is_prep` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_moves` ADD `purchase_id` char(36);--> statement-breakpoint
ALTER TABLE `prep_lines` ADD CONSTRAINT `fk_prep_lines_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prep_lines` ADD CONSTRAINT `fk_prep_lines_prep` FOREIGN KEY (`tenant_id`,`prep_item_id`) REFERENCES `stock_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prep_lines` ADD CONSTRAINT `fk_prep_lines_stock` FOREIGN KEY (`tenant_id`,`stock_item_id`) REFERENCES `stock_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchases` ADD CONSTRAINT `fk_purchases_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchases` ADD CONSTRAINT `fk_purchases_supplier` FOREIGN KEY (`tenant_id`,`supplier_id`) REFERENCES `suppliers`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchases` ADD CONSTRAINT `fk_purchases_by` FOREIGN KEY (`tenant_id`,`by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `fk_supplier_payments_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `fk_supplier_payments_supplier` FOREIGN KEY (`tenant_id`,`supplier_id`) REFERENCES `suppliers`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `fk_supplier_payments_purchase` FOREIGN KEY (`tenant_id`,`purchase_id`) REFERENCES `purchases`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `fk_supplier_payments_by` FOREIGN KEY (`tenant_id`,`by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `fk_suppliers_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `purchases_outlet_date_idx` ON `purchases` (`outlet_id`,`bill_date`);--> statement-breakpoint
CREATE INDEX `purchases_supplier_idx` ON `purchases` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `supplier_payments_supplier_idx` ON `supplier_payments` (`supplier_id`,`created_at`);