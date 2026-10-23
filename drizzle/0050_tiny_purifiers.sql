CREATE TABLE `staff_invitation_otps` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`invitation_id` char(36) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`resend_at` datetime(3) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`verified_at` datetime(3),
	`dead_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `staff_invitation_otps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_invitations` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`role` enum('manager','reception','waiter','accountant','kitchen') NOT NULL,
	`token_hash` char(64) NOT NULL,
	`created_by_user_id` char(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`accepted_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `staff_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_invitations_token_uq` UNIQUE(`token_hash`),
	CONSTRAINT `staff_invitations_tenant_id_uq` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `staff_invitation_otps` ADD CONSTRAINT `fk_staff_invitation_otps_invite` FOREIGN KEY (`tenant_id`,`invitation_id`) REFERENCES `staff_invitations`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_invitations` ADD CONSTRAINT `fk_staff_invitations_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_invitations` ADD CONSTRAINT `fk_staff_invitations_creator` FOREIGN KEY (`tenant_id`,`created_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `staff_invitation_otps_invite_idx` ON `staff_invitation_otps` (`tenant_id`,`invitation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `staff_invitation_otps_phone_idx` ON `staff_invitation_otps` (`tenant_id`,`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `staff_invitations_outlet_idx` ON `staff_invitations` (`tenant_id`,`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `staff_invitations_phone_idx` ON `staff_invitations` (`tenant_id`,`phone`,`created_at`);