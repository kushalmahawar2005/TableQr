ALTER TABLE `reservations` ADD `credit_required_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `credit_paid_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `credit_applied_paise` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `credit_status` enum('none','required','pending','paid','applied','refunded','forfeited','failed') DEFAULT 'none' NOT NULL;