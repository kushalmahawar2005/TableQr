CREATE TABLE `booking_calendar_exceptions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`service_date` date NOT NULL,
	`kind` enum('holiday','blackout','special_event') NOT NULL,
	`name` varchar(120) NOT NULL,
	`online_bookings_paused` boolean NOT NULL DEFAULT true,
	`opens_at` varchar(5),
	`closes_at` varchar(5),
	`created_by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `booking_calendar_exceptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `booking_calendar_exceptions_uq` UNIQUE(`outlet_id`,`service_date`)
);
--> statement-breakpoint
CREATE TABLE `booking_notifications` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`reservation_id` char(36),
	`waitlist_entry_id` char(36),
	`type` enum('otp','booking_confirmation','booking_reminder_24h','booking_reminder_2h','waitlist_joined','waitlist_two_ahead','waitlist_ready','waitlist_expired','booking_cancelled','refund_update') NOT NULL,
	`recipient` varchar(160) NOT NULL,
	`channel` varchar(30) NOT NULL,
	`idempotency_key` varchar(120) NOT NULL,
	`provider_ref` varchar(120),
	`status` enum('pending','processing','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` varchar(200),
	`scheduled_at` datetime(3) NOT NULL,
	`sent_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `booking_notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `booking_notifications_idempotency_uq` UNIQUE(`tenant_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `reservation_credits` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`reservation_id` char(36) NOT NULL,
	`client_request_id` varchar(64) NOT NULL,
	`provider` varchar(30),
	`gateway_ref` varchar(100),
	`gateway_payment_id` varchar(100),
	`amount_paise` int NOT NULL,
	`paid_paise` int NOT NULL DEFAULT 0,
	`applied_paise` int NOT NULL DEFAULT 0,
	`status` enum('required','pending','paid','applied','refunded','forfeited','failed') NOT NULL DEFAULT 'required',
	`refund_gateway_ref` varchar(100),
	`refund_status` enum('none','pending','success','failed') NOT NULL DEFAULT 'none',
	`failure_reason` varchar(200),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `reservation_credits_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservation_credits_request_uq` UNIQUE(`tenant_id`,`reservation_id`,`client_request_id`),
	CONSTRAINT `reservation_credits_gateway_uq` UNIQUE(`provider`,`gateway_ref`),
	CONSTRAINT `reservation_credits_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_history` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`reservation_id` char(36) NOT NULL,
	`kind` enum('created','hold_created','hold_released','confirmed','cancelled','restaurant_cancelled','rescheduled','late_extended','arrived','seated','completed','no_show') NOT NULL,
	`actor_user_id` char(36),
	`before` json,
	`after` json,
	`reason` varchar(200),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `reservation_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `booking_policies` MODIFY COLUMN `max_party_size` int NOT NULL DEFAULT 12;--> statement-breakpoint
ALTER TABLE `booking_policies` MODIFY COLUMN `hold_minutes` int NOT NULL DEFAULT 5;--> statement-breakpoint
ALTER TABLE `booking_policies` MODIFY COLUMN `turnover_buffer_minutes` int NOT NULL DEFAULT 10;--> statement-breakpoint
ALTER TABLE `waitlist_entries` MODIFY COLUMN `status` enum('waiting','notified','seated','skipped','left','expired') NOT NULL DEFAULT 'waiting';--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `free_cancellation_minutes` int DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `late_extension_minutes` int DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `ready_window_minutes` int DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `fallback_wait_minutes` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `minimum_history_parties` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `peak_credit_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `repeat_no_show_credit_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_policies` ADD `repeat_no_show_threshold` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `public_reference` varchar(20);--> statement-breakpoint
ALTER TABLE `reservations` ADD `manage_token_hash` char(64);--> statement-breakpoint
ALTER TABLE `reservations` ADD `manage_token_expires_at` datetime(3);--> statement-breakpoint
ALTER TABLE `reservations` ADD `booking_request_id` varchar(64);--> statement-breakpoint
ALTER TABLE `reservations` ADD `seating_preference` varchar(40);--> statement-breakpoint
ALTER TABLE `reservations` ADD `requested_zone_id` char(36);--> statement-breakpoint
ALTER TABLE `reservations` ADD `requested_table_class` varchar(20);--> statement-breakpoint
ALTER TABLE `reservations` ADD `hold_owner_hash` char(64);--> statement-breakpoint
ALTER TABLE `reservations` ADD `hold_released_at` datetime(3);--> statement-breakpoint
ALTER TABLE `reservations` ADD `hold_release_reason` varchar(80);--> statement-breakpoint
ALTER TABLE `reservations` ADD `restaurant_cancelled_at` datetime(3);--> statement-breakpoint
ALTER TABLE `reservations` ADD `restaurant_cancel_reason` varchar(200);--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `guest_id` char(36);--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `seating_preference` varchar(40);--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `ready_deadline` datetime(3);--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `estimate_minutes` int;--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `estimate_source` enum('historical','fallback','staff');--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `manage_token_hash` char(64);--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `manage_token_expires_at` datetime(3);--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_public_reference_uq` UNIQUE(`tenant_id`,`public_reference`);--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_booking_request_uq` UNIQUE(`tenant_id`,`booking_request_id`);--> statement-breakpoint
ALTER TABLE `booking_calendar_exceptions` ADD CONSTRAINT `fk_booking_exceptions_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_calendar_exceptions` ADD CONSTRAINT `fk_booking_exceptions_by` FOREIGN KEY (`tenant_id`,`created_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_notifications` ADD CONSTRAINT `fk_booking_notifications_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_notifications` ADD CONSTRAINT `fk_booking_notifications_reservation` FOREIGN KEY (`tenant_id`,`reservation_id`) REFERENCES `reservations`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_notifications` ADD CONSTRAINT `fk_booking_notifications_waitlist` FOREIGN KEY (`tenant_id`,`waitlist_entry_id`) REFERENCES `waitlist_entries`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_credits` ADD CONSTRAINT `fk_reservation_credits_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_credits` ADD CONSTRAINT `fk_reservation_credits_reservation` FOREIGN KEY (`tenant_id`,`reservation_id`) REFERENCES `reservations`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_history` ADD CONSTRAINT `fk_reservation_history_reservation` FOREIGN KEY (`tenant_id`,`reservation_id`) REFERENCES `reservations`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_history` ADD CONSTRAINT `fk_reservation_history_actor` FOREIGN KEY (`tenant_id`,`actor_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `booking_notifications_due_idx` ON `booking_notifications` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `reservation_credits_status_idx` ON `reservation_credits` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `reservation_history_idx` ON `reservation_history` (`tenant_id`,`reservation_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `fk_reservations_zone` FOREIGN KEY (`tenant_id`,`requested_zone_id`) REFERENCES `zones`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD CONSTRAINT `fk_waitlist_guest` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;