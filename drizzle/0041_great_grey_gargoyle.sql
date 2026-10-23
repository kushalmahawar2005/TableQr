ALTER TABLE `outlets` ADD `custom_domain` varchar(253);--> statement-breakpoint
ALTER TABLE `outlets` ADD `custom_domain_token` varchar(64);--> statement-breakpoint
ALTER TABLE `outlets` ADD `custom_domain_verified_at` datetime(3);--> statement-breakpoint
ALTER TABLE `outlets` ADD CONSTRAINT `outlets_custom_domain_uq` UNIQUE(`custom_domain`);