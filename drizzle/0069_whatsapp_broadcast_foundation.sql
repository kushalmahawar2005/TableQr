CREATE TABLE `broadcast_campaigns` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`template_id` char(36) NOT NULL,
	`header_media_url` varchar(500),
	`variables` json NOT NULL,
	`offer_code` varchar(30),
	`link_url` varchar(500),
	`segment` json NOT NULL,
	`status` enum('draft','scheduled','sending','sent','cancelled','failed') NOT NULL DEFAULT 'draft',
	`scheduled_at` datetime(3),
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`audience_count` int NOT NULL DEFAULT 0,
	`credits_reserved` int NOT NULL DEFAULT 0,
	`credits_used` int NOT NULL DEFAULT 0,
	`created_by` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `broadcast_campaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `broadcast_campaigns_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `broadcast_recipients` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`campaign_id` char(36) NOT NULL,
	`guest_id` char(36) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`name` varchar(80),
	`status` enum('queued','sent','delivered','read','failed','skipped') NOT NULL DEFAULT 'queued',
	`wa_message_id` varchar(80),
	`error_code` varchar(20),
	`error_text` varchar(300),
	`refunded` boolean NOT NULL DEFAULT false,
	`sent_at` datetime(3),
	`delivered_at` datetime(3),
	`read_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `broadcast_recipients_id` PRIMARY KEY(`id`),
	CONSTRAINT `broadcast_recipients_guest_uq` UNIQUE(`campaign_id`,`guest_id`),
	CONSTRAINT `broadcast_recipients_wamid_uq` UNIQUE(`wa_message_id`)
);
--> statement-breakpoint
CREATE TABLE `message_credit_ledger` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`delta` int NOT NULL,
	`balance_after` int NOT NULL,
	`reason` enum('purchase','grant','adjust','broadcast_reserve','broadcast_refund') NOT NULL,
	`campaign_id` char(36),
	`outlet_id` char(36),
	`actor_label` varchar(80) NOT NULL,
	`note` varchar(200),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `message_credit_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_accounts` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`waba_id` varchar(40) NOT NULL,
	`phone_number_id` varchar(40) NOT NULL,
	`display_phone` varchar(30),
	`verified_name` varchar(120),
	`access_token` text NOT NULL,
	`status` enum('connected','disconnected','error') NOT NULL DEFAULT 'connected',
	`quality_rating` varchar(20),
	`messaging_tier` varchar(30),
	`last_error` varchar(300),
	`connected_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `whatsapp_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_accounts_tenant_uq` UNIQUE(`tenant_id`),
	CONSTRAINT `whatsapp_accounts_phone_uq` UNIQUE(`phone_number_id`),
	CONSTRAINT `whatsapp_accounts_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_templates` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`account_id` char(36) NOT NULL,
	`meta_template_id` varchar(40),
	`name` varchar(512) NOT NULL,
	`language` varchar(10) NOT NULL DEFAULT 'en',
	`category` enum('MARKETING','UTILITY') NOT NULL DEFAULT 'MARKETING',
	`header` enum('none','image','video') NOT NULL DEFAULT 'none',
	`body` text NOT NULL,
	`footer` varchar(60),
	`buttons` json,
	`status` enum('draft','pending','approved','rejected','paused','disabled') NOT NULL DEFAULT 'draft',
	`rejection_reason` varchar(300),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `whatsapp_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_templates_name_uq` UNIQUE(`tenant_id`,`account_id`,`name`,`language`),
	CONSTRAINT `whatsapp_templates_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `tenants` ADD `message_credits` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `guests` ADD `marketing_opt_out_at` datetime(3);--> statement-breakpoint
ALTER TABLE `guests` ADD `birthday` varchar(10);--> statement-breakpoint
ALTER TABLE `guests` ADD `last_marketing_at` datetime(3);--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD CONSTRAINT `fk_broadcast_campaigns_template` FOREIGN KEY (`tenant_id`,`template_id`) REFERENCES `whatsapp_templates`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD CONSTRAINT `fk_broadcast_campaigns_by` FOREIGN KEY (`tenant_id`,`created_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `broadcast_recipients` ADD CONSTRAINT `fk_broadcast_recipients_campaign` FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `broadcast_campaigns`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `broadcast_recipients` ADD CONSTRAINT `fk_broadcast_recipients_guest` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_credit_ledger` ADD CONSTRAINT `message_credit_ledger_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_credit_ledger` ADD CONSTRAINT `fk_message_credit_ledger_campaign` FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `broadcast_campaigns`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_credit_ledger` ADD CONSTRAINT `fk_message_credit_ledger_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsapp_templates` ADD CONSTRAINT `fk_whatsapp_templates_account` FOREIGN KEY (`tenant_id`,`account_id`) REFERENCES `whatsapp_accounts`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `broadcast_campaigns_due_idx` ON `broadcast_campaigns` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `broadcast_campaigns_tenant_idx` ON `broadcast_campaigns` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `broadcast_recipients_queue_idx` ON `broadcast_recipients` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `message_credit_ledger_tenant_idx` ON `message_credit_ledger` (`tenant_id`,`created_at`);