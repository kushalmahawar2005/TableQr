ALTER TABLE `outlets` ADD `booking_payment_mode` enum('gateway','manual_qr') DEFAULT 'gateway' NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `booking_payment_qr_url` varchar(500);--> statement-breakpoint
ALTER TABLE `reservations` ADD `manual_advance_reference` varchar(40);--> statement-breakpoint
ALTER TABLE `reservations` ADD `manual_advance_claimed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `reservations` ADD `manual_advance_confirmed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `reservations` ADD `advance_payment_mode` enum('gateway','manual_qr') DEFAULT 'gateway' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `advance_payment_qr_url` varchar(500);--> statement-breakpoint
ALTER TABLE `reservations` ADD `booking_device_id` varchar(64);