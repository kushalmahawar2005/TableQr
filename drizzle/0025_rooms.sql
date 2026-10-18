CREATE TABLE `room_requests` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`room_id` char(36) NOT NULL,
	`stay_id` char(36) NOT NULL,
	`kind` enum('housekeeping','towels','water','toiletries','laundry','maintenance','wake_up','other') NOT NULL,
	`note` varchar(140),
	`status` enum('open','done') NOT NULL DEFAULT 'open',
	`created_at` datetime(3) NOT NULL,
	`done_at` datetime(3),
	`done_by_user_id` char(36),
	CONSTRAINT `room_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `room_stays` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`room_id` char(36) NOT NULL,
	`guest_name` varchar(80) NOT NULL,
	`guest_phone` varchar(15),
	`guests` int NOT NULL DEFAULT 1,
	`food_pay` enum('at_checkout','per_order') NOT NULL DEFAULT 'at_checkout',
	`note` varchar(140),
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`open_key` char(36),
	`check_in_at` datetime(3) NOT NULL,
	`expected_check_out_at` datetime(3),
	`check_out_at` datetime(3),
	`checked_in_by_user_id` char(36),
	`checked_out_by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `room_stays_id` PRIMARY KEY(`id`),
	CONSTRAINT `room_stays_open_uq` UNIQUE(`open_key`),
	CONSTRAINT `room_stays_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`number` varchar(7) NOT NULL,
	`room_type` varchar(40),
	`floor_label` varchar(40),
	`table_id` char(36) NOT NULL,
	`status` enum('vacant','occupied','cleaning','blocked') NOT NULL DEFAULT 'vacant',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `rooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `rooms_outlet_number_uq` UNIQUE(`outlet_id`,`number`),
	CONSTRAINT `rooms_table_uq` UNIQUE(`table_id`),
	CONSTRAINT `rooms_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `staff_roles` MODIFY COLUMN `role` enum('owner','manager','cashier','host','waiter','kitchen','accountant','reception') NOT NULL;--> statement-breakpoint
ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_room` FOREIGN KEY (`tenant_id`,`room_id`) REFERENCES `rooms`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_stay` FOREIGN KEY (`tenant_id`,`stay_id`) REFERENCES `room_stays`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `room_requests` ADD CONSTRAINT `fk_room_requests_done_by` FOREIGN KEY (`tenant_id`,`done_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_room` FOREIGN KEY (`tenant_id`,`room_id`) REFERENCES `rooms`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_in_by` FOREIGN KEY (`tenant_id`,`checked_in_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `room_stays` ADD CONSTRAINT `fk_room_stays_out_by` FOREIGN KEY (`tenant_id`,`checked_out_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rooms` ADD CONSTRAINT `fk_rooms_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rooms` ADD CONSTRAINT `fk_rooms_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `room_requests_outlet_status_idx` ON `room_requests` (`outlet_id`,`status`);--> statement-breakpoint
CREATE INDEX `room_requests_stay_idx` ON `room_requests` (`stay_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `room_stays_outlet_idx` ON `room_stays` (`outlet_id`,`check_in_at`);--> statement-breakpoint
-- Plans saved before these switches: every one has restaurant tables and no rooms
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.dineIn', JSON_EXTRACT('true', '$')) WHERE JSON_EXTRACT(`features`, '$.dineIn') IS NULL;--> statement-breakpoint
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.rooms', JSON_EXTRACT('false', '$')) WHERE JSON_EXTRACT(`features`, '$.rooms') IS NULL;--> statement-breakpoint
-- The two hotel plans
INSERT INTO `plans` (`code`, `name`, `monthly_price_paise`, `features`, `is_public`, `sort_order`, `created_at`, `updated_at`) SELECT 'hotel', 'Hotel', 299900, '{"dineIn":false,"rooms":true,"waiterApp":false,"discounts":true,"whatsappBills":true,"groupSplit":false,"reservations":false,"kitchenDisplay":true,"pricingRules":false,"fullReports":true,"multiOutlet":false,"inventory":false,"maxTables":null,"maxStaff":10,"maxRooms":30,"poweredBy":false}', 1, 4, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `plans` WHERE `code` = 'hotel');--> statement-breakpoint
INSERT INTO `plans` (`code`, `name`, `monthly_price_paise`, `features`, `is_public`, `sort_order`, `created_at`, `updated_at`) SELECT 'hotel_plus', 'Hotel + Restaurant', 699900, '{"dineIn":true,"rooms":true,"waiterApp":true,"discounts":true,"whatsappBills":true,"groupSplit":true,"reservations":true,"kitchenDisplay":true,"pricingRules":true,"fullReports":true,"multiOutlet":false,"inventory":true,"maxTables":20,"maxStaff":25,"maxRooms":30,"poweredBy":false}', 1, 5, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `plans` WHERE `code` = 'hotel_plus');
