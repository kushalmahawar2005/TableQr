ALTER TABLE `service_requests` MODIFY COLUMN `kind` enum('water','cutlery','call_waiter','clean_table','request_bill','pay_at_counter','paid_upi','confirm_order') NOT NULL;--> statement-breakpoint
ALTER TABLE `guests` ADD `blocked_at` datetime(3);--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `needs_staff_check` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `staff_confirmed_at` datetime(3);