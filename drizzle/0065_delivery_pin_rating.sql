ALTER TABLE `delivery_checkouts` ADD `delivery_pin` varchar(4);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `pin_attempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `payment_issue` varchar(300);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `payment_issue_at` datetime(3);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `rider_rating` int;--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `rider_rating_note` varchar(200);--> statement-breakpoint
ALTER TABLE `delivery_checkouts` ADD `rider_rated_at` datetime(3);--> statement-breakpoint
CREATE INDEX `delivery_rider_rating_idx` ON `delivery_checkouts` (`tenant_id`,`courier_user_id`,`rider_rating`);