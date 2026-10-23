ALTER TABLE `cart_lines` ADD `personal_for_pickup` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `personal_for_pickup` boolean DEFAULT false NOT NULL;