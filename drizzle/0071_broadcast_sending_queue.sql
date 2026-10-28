ALTER TABLE `broadcast_recipients` MODIFY COLUMN `status` enum('queued','sending','unknown','sent','delivered','read','failed','skipped') NOT NULL DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD `request_id` varchar(64);--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD `request_fingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD `audience_limit` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD `timezone` varchar(40) DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD `template_snapshot` json;--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD `failure_reason` varchar(300);--> statement-breakpoint
ALTER TABLE `broadcast_recipients` ADD `attempted_at` datetime(3);--> statement-breakpoint
ALTER TABLE `whatsapp_accounts` ADD `next_send_at` datetime(3);--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD CONSTRAINT `broadcast_campaigns_request_uq` UNIQUE(`tenant_id`,`request_id`);--> statement-breakpoint
ALTER TABLE `broadcast_recipients` ADD CONSTRAINT `broadcast_recipients_phone_uq` UNIQUE(`campaign_id`,`phone`);