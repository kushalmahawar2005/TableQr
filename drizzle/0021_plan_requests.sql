CREATE TABLE `plan_requests` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36),
	`requested_by` varchar(80) NOT NULL,
	`feature` varchar(30),
	`note` varchar(300),
	`status` enum('open','done') NOT NULL DEFAULT 'open',
	`created_at` datetime(3) NOT NULL,
	`done_at` datetime(3),
	CONSTRAINT `plan_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `plan_requests` ADD CONSTRAINT `plan_requests_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `plan_requests_tenant_status_idx` ON `plan_requests` (`tenant_id`,`status`);