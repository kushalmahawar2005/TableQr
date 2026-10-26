ALTER TABLE `guest_push_subscriptions` ADD `reservation_id` char(36);--> statement-breakpoint
CREATE INDEX `guest_push_reservation_idx` ON `guest_push_subscriptions` (`tenant_id`,`reservation_id`);