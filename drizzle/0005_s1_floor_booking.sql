CREATE TABLE `staff_login_attempts` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`ok` boolean NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `staff_login_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3),
	`revoked_at` datetime(3),
	CONSTRAINT `staff_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_sessions_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `session_tables` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`table_id` char(36) NOT NULL,
	`is_primary` boolean NOT NULL DEFAULT false,
	`active_key` char(36),
	`assigned_at` datetime(3) NOT NULL,
	`released_at` datetime(3),
	`assigned_by_user_id` char(36),
	CONSTRAINT `session_tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_tables_active_uq` UNIQUE(`active_key`)
);
--> statement-breakpoint
CREATE TABLE `booking_policies` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`booking_window_days` int NOT NULL DEFAULT 30,
	`online_cutoff_minutes` int NOT NULL DEFAULT 60,
	`min_party_size` int NOT NULL DEFAULT 1,
	`max_party_size` int NOT NULL DEFAULT 8,
	`slot_interval_minutes` int NOT NULL DEFAULT 30,
	`hold_minutes` int NOT NULL DEFAULT 10,
	`dining_minutes` json,
	`turnover_buffer_minutes` int NOT NULL DEFAULT 15,
	`grace_minutes` int NOT NULL DEFAULT 15,
	`reserve_ahead_minutes` int NOT NULL DEFAULT 30,
	`pacing_covers_per_slot` int NOT NULL DEFAULT 40,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `booking_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `booking_policies_outlet_uq` UNIQUE(`outlet_id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_tables` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`reservation_id` char(36) NOT NULL,
	`table_id` char(36) NOT NULL,
	CONSTRAINT `reservation_tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservation_tables_uq` UNIQUE(`reservation_id`,`table_id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`guest_id` char(36),
	`name` varchar(80) NOT NULL,
	`phone` varchar(15),
	`party_size` int NOT NULL,
	`start_at` datetime(3) NOT NULL,
	`expected_end_at` datetime(3) NOT NULL,
	`status` enum('requested','confirmed','reminded','arrived','seated','completed','cancelled','no_show') NOT NULL DEFAULT 'requested',
	`source` enum('online','phone','walk_in','staff') NOT NULL DEFAULT 'staff',
	`occasion` varchar(40),
	`notes` varchar(300),
	`hold_expires_at` datetime(3),
	`session_id` char(36),
	`confirmed_at` datetime(3),
	`reminded_at` datetime(3),
	`arrived_at` datetime(3),
	`seated_at` datetime(3),
	`completed_at` datetime(3),
	`cancelled_at` datetime(3),
	`no_show_at` datetime(3),
	`created_by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservations_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `service_day_overrides` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`service_date` date NOT NULL,
	`online_bookings_paused` boolean NOT NULL DEFAULT false,
	`reason` varchar(120),
	`updated_by_user_id` char(36),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `service_day_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `service_day_overrides_uq` UNIQUE(`outlet_id`,`service_date`)
);
--> statement-breakpoint
CREATE TABLE `slot_capacity_overrides` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`slot_start_at` datetime(3) NOT NULL,
	`extra_covers` int NOT NULL,
	`reason` varchar(120),
	`updated_by_user_id` char(36),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `slot_capacity_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `slot_capacity_overrides_uq` UNIQUE(`outlet_id`,`slot_start_at`)
);
--> statement-breakpoint
CREATE TABLE `waitlist_entries` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`name` varchar(80) NOT NULL,
	`phone` varchar(15),
	`party_size` int NOT NULL,
	`joined_at` datetime(3) NOT NULL,
	`quoted_minutes` int,
	`status` enum('waiting','notified','seated','skipped','left') NOT NULL DEFAULT 'waiting',
	`sort_order` int NOT NULL,
	`notes` varchar(200),
	`notified_at` datetime(3),
	`seated_at` datetime(3),
	`closed_at` datetime(3),
	`session_id` char(36),
	`created_by_user_id` char(36),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `waitlist_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `waitlist_entries_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `state_changed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `blocked_reason` enum('maintenance','private_event','out_of_service','other');--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `blocked_note` varchar(120);--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `blocked_until` datetime(3);--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `blocked_by_user_id` char(36);--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `source` enum('qr','walk_in','reservation','waitlist') DEFAULT 'qr' NOT NULL;--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `party_size` int;--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `guest_name` varchar(80);--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `expected_end_at` datetime(3);--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `opened_by_user_id` char(36);--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `reservation_id` char(36);--> statement-breakpoint
ALTER TABLE `staff_sessions` ADD CONSTRAINT `fk_staff_sessions_user` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_sessions` ADD CONSTRAINT `fk_staff_sessions_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session_tables` ADD CONSTRAINT `fk_session_tables_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session_tables` ADD CONSTRAINT `fk_session_tables_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session_tables` ADD CONSTRAINT `fk_session_tables_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session_tables` ADD CONSTRAINT `fk_session_tables_by` FOREIGN KEY (`tenant_id`,`assigned_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD CONSTRAINT `fk_booking_policies_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_tables` ADD CONSTRAINT `fk_reservation_tables_reservation` FOREIGN KEY (`tenant_id`,`reservation_id`) REFERENCES `reservations`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_tables` ADD CONSTRAINT `fk_reservation_tables_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `fk_reservations_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `fk_reservations_guest` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `fk_reservations_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `fk_reservations_created_by` FOREIGN KEY (`tenant_id`,`created_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_day_overrides` ADD CONSTRAINT `fk_service_day_overrides_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_day_overrides` ADD CONSTRAINT `fk_service_day_overrides_by` FOREIGN KEY (`tenant_id`,`updated_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `slot_capacity_overrides` ADD CONSTRAINT `fk_slot_capacity_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `slot_capacity_overrides` ADD CONSTRAINT `fk_slot_capacity_by` FOREIGN KEY (`tenant_id`,`updated_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD CONSTRAINT `fk_waitlist_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD CONSTRAINT `fk_waitlist_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD CONSTRAINT `fk_waitlist_created_by` FOREIGN KEY (`tenant_id`,`created_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `staff_login_attempts_phone_idx` ON `staff_login_attempts` (`tenant_id`,`outlet_id`,`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `staff_sessions_user_idx` ON `staff_sessions` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `session_tables_session_idx` ON `session_tables` (`tenant_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `session_tables_table_idx` ON `session_tables` (`tenant_id`,`table_id`);--> statement-breakpoint
CREATE INDEX `reservation_tables_table_idx` ON `reservation_tables` (`tenant_id`,`table_id`);--> statement-breakpoint
CREATE INDEX `reservations_outlet_start_idx` ON `reservations` (`tenant_id`,`outlet_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `waitlist_outlet_status_idx` ON `waitlist_entries` (`tenant_id`,`outlet_id`,`status`,`sort_order`);--> statement-breakpoint
ALTER TABLE `dining_tables` ADD CONSTRAINT `fk_dining_tables_blocked_by` FOREIGN KEY (`tenant_id`,`blocked_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `table_sessions` ADD CONSTRAINT `fk_sessions_opened_by` FOREIGN KEY (`tenant_id`,`opened_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO `session_tables` (`id`, `tenant_id`, `outlet_id`, `session_id`, `table_id`, `is_primary`, `active_key`, `assigned_at`, `released_at`)
SELECT UUID(), `tenant_id`, `outlet_id`, `id`, `table_id`, true, CASE WHEN `status` = 'closed' THEN NULL ELSE `table_id` END, `opened_at`, `closed_at`
FROM `table_sessions`;
