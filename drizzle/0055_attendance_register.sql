CREATE TABLE `attendance_marks` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`mark_date` varchar(10) NOT NULL,
	`status` enum('present','half_day','absent','leave','week_off') NOT NULL,
	`note` varchar(200),
	`marked_by` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `attendance_marks_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_marks_person_day_uq` UNIQUE(`tenant_id`,`user_id`,`mark_date`)
);
--> statement-breakpoint
ALTER TABLE `attendance_marks` ADD CONSTRAINT `fk_attendance_marks_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_marks` ADD CONSTRAINT `fk_attendance_marks_user` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_marks` ADD CONSTRAINT `fk_attendance_marks_by` FOREIGN KEY (`tenant_id`,`marked_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendance_marks_outlet_day_idx` ON `attendance_marks` (`tenant_id`,`outlet_id`,`mark_date`);