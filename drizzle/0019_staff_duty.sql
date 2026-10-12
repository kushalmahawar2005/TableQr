ALTER TABLE `users` ADD `duty_status` enum('on','break','off') DEFAULT 'on' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `duty_changed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` datetime(3);