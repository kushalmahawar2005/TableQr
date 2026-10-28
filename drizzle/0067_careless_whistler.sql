ALTER TABLE `table_sessions` ADD `staff_request_id` varchar(64);--> statement-breakpoint
ALTER TABLE `table_sessions` ADD `staff_request_fingerprint` char(64);--> statement-breakpoint
ALTER TABLE `table_sessions` ADD CONSTRAINT `table_sessions_staff_request_uq` UNIQUE(`outlet_id`,`staff_request_id`);