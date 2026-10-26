ALTER TABLE `service_requests` MODIFY COLUMN `kind` enum('water','cutlery','call_waiter','clean_table','request_bill','pay_at_counter','paid_upi') NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `upi_id` varchar(60);--> statement-breakpoint
ALTER TABLE `outlets` ADD `upi_name` varchar(60);