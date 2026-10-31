ALTER TABLE `staff_push_subscriptions` ADD `session_id` char(36);--> statement-breakpoint
CREATE INDEX `staff_push_session_idx` ON `staff_push_subscriptions` (`tenant_id`,`session_id`);