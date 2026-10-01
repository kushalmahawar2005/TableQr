CREATE TABLE `join_code_attempts` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`table_id` char(36) NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `join_code_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `join_code_attempts` ADD CONSTRAINT `fk_join_code_attempts_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `join_code_attempts_table_idx` ON `join_code_attempts` (`tenant_id`,`table_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `join_code_attempts_device_idx` ON `join_code_attempts` (`tenant_id`,`device_id`,`created_at`);