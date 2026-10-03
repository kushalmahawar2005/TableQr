CREATE TABLE `group_requests` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`public_reference` varchar(20) NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`party_size` int NOT NULL,
	`desired_date` date NOT NULL,
	`desired_start_at` datetime(3) NOT NULL,
	`notes` varchar(500),
	`status` enum('requested','contacted','converted','cancelled') NOT NULL DEFAULT 'requested',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `group_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_requests_reference_uq` UNIQUE(`tenant_id`,`public_reference`),
	CONSTRAINT `group_requests_request_uq` UNIQUE(`tenant_id`,`request_id`),
	CONSTRAINT `group_requests_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `group_requests` ADD CONSTRAINT `fk_group_requests_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `group_requests_outlet_date_idx` ON `group_requests` (`tenant_id`,`outlet_id`,`desired_date`,`status`);