CREATE TABLE `rider_documents` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`status` enum('pending','verified','rejected') NOT NULL DEFAULT 'pending',
	`aadhaar_last4` char(4),
	`front_key` varchar(200),
	`back_key` varchar(200),
	`consent_at` datetime(3) NOT NULL,
	`submitted_at` datetime(3) NOT NULL,
	`reviewed_at` datetime(3),
	`reviewed_by_user_id` char(36),
	`note` varchar(200),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `rider_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `rider_documents_user_uq` UNIQUE(`tenant_id`,`user_id`),
	CONSTRAINT `rider_documents_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `rider_documents` ADD CONSTRAINT `fk_rider_documents_user` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;