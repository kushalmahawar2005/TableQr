ALTER TABLE `outlets` ADD `room_services` json;--> statement-breakpoint
ALTER TABLE `outlets` ADD `wifi_ssid` varchar(32);--> statement-breakpoint
ALTER TABLE `outlets` ADD `wifi_password` varchar(63);