CREATE TABLE `print_jobs` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`printer_id` char(36),
	`kind` varchar(20) NOT NULL,
	`subject_type` varchar(20),
	`subject_id` varchar(40),
	`request_id` varchar(64) NOT NULL,
	`transport` varchar(30) NOT NULL,
	`paper_mm` int NOT NULL,
	`status` enum('queued','sent','confirmed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`failure_code` varchar(40),
	`failure_detail` varchar(200),
	`attempts` int NOT NULL DEFAULT 1,
	`reprint_of` char(36),
	`actor_user_id` char(36),
	`device_id` char(36),
	`status_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `print_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `print_jobs_request_uq` UNIQUE(`tenant_id`,`request_id`)
);
--> statement-breakpoint
CREATE TABLE `print_settings` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`receipt_printer_id` char(36),
	`kitchen_printer_id` char(36),
	`updated_by` char(36),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `print_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `print_settings_outlet_uq` UNIQUE(`tenant_id`,`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `printers` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`name` varchar(60) NOT NULL,
	`paper_mm` int NOT NULL DEFAULT 80,
	`transport` varchar(30) NOT NULL DEFAULT 'browser',
	`config` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `printers_id` PRIMARY KEY(`id`),
	CONSTRAINT `printers_outlet_name_uq` UNIQUE(`tenant_id`,`outlet_id`,`name`),
	CONSTRAINT `printers_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `print_jobs` ADD CONSTRAINT `fk_print_jobs_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `print_jobs` ADD CONSTRAINT `fk_print_jobs_printer` FOREIGN KEY (`tenant_id`,`printer_id`) REFERENCES `printers`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `print_jobs` ADD CONSTRAINT `fk_print_jobs_actor` FOREIGN KEY (`tenant_id`,`actor_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `print_settings` ADD CONSTRAINT `fk_print_settings_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `print_settings` ADD CONSTRAINT `fk_print_settings_receipt` FOREIGN KEY (`tenant_id`,`receipt_printer_id`) REFERENCES `printers`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `print_settings` ADD CONSTRAINT `fk_print_settings_kitchen` FOREIGN KEY (`tenant_id`,`kitchen_printer_id`) REFERENCES `printers`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `print_settings` ADD CONSTRAINT `fk_print_settings_by` FOREIGN KEY (`tenant_id`,`updated_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printers` ADD CONSTRAINT `fk_printers_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printers` ADD CONSTRAINT `fk_printers_created_by` FOREIGN KEY (`tenant_id`,`created_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `print_jobs_outlet_created_idx` ON `print_jobs` (`tenant_id`,`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `print_jobs_subject_idx` ON `print_jobs` (`tenant_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `print_jobs_created_idx` ON `print_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `printers_outlet_idx` ON `printers` (`tenant_id`,`outlet_id`,`is_active`);