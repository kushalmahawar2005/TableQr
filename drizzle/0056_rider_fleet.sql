ALTER TABLE `staff_roles` MODIFY COLUMN `role` enum('owner','manager','cashier','host','waiter','kitchen','accountant','reception','rider') NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_invitations` MODIFY COLUMN `role` enum('manager','reception','waiter','accountant','kitchen','rider') NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `photo_url` varchar(500);--> statement-breakpoint
ALTER TABLE `users` ADD `vehicle_no` varchar(20);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `courier_user_id` char(36);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `picked_up_at` datetime(3);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `delivered_at` datetime(3);--> statement-breakpoint
CREATE INDEX `delivery_courier_idx` ON `delivery_checkouts` (`tenant_id`,`courier_user_id`,`status`);