ALTER TABLE `broadcast_campaigns` ADD `outlet_id` char(36);--> statement-breakpoint
ALTER TABLE `message_credit_ledger` ADD `fee_id` char(36);--> statement-breakpoint
ALTER TABLE `fee_payments` ADD CONSTRAINT `fee_payments_tenant_key` UNIQUE(`tenant_id`,`id`);--> statement-breakpoint
ALTER TABLE `broadcast_campaigns` ADD CONSTRAINT `fk_broadcast_campaigns_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_credit_ledger` ADD CONSTRAINT `fk_message_credit_ledger_fee` FOREIGN KEY (`tenant_id`,`fee_id`) REFERENCES `fee_payments`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;