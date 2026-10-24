ALTER TABLE `outlets` ADD `announcement_active` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `outlets` ADD `announcement_title` varchar(80);--> statement-breakpoint
ALTER TABLE `outlets` ADD `announcement_body` varchar(240);