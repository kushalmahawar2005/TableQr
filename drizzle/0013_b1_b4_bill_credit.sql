ALTER TABLE `bills` ADD `booking_credit_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `booking_credit_reservation_id` char(36);--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `fk_bills_booking_credit_reservation` FOREIGN KEY (`tenant_id`,`booking_credit_reservation_id`) REFERENCES `reservations`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;