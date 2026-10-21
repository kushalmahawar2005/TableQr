ALTER TABLE `fee_payments` MODIFY COLUMN `method` enum('cashfree','upi','cash','bank') NOT NULL DEFAULT 'cashfree';--> statement-breakpoint
ALTER TABLE `fee_payments` ADD `client_request_id` varchar(64);--> statement-breakpoint
ALTER TABLE `fee_payments` ADD `gateway_ref` varchar(100);--> statement-breakpoint
ALTER TABLE `fee_payments` ADD `gateway_payment_id` varchar(100);--> statement-breakpoint
ALTER TABLE `fee_payments` ADD `failure_reason` varchar(200);--> statement-breakpoint
ALTER TABLE `fee_payments` ADD `checked_at` datetime(3);--> statement-breakpoint
ALTER TABLE `fee_payments` ADD CONSTRAINT `fee_payments_request_uq` UNIQUE(`tenant_id`,`client_request_id`);--> statement-breakpoint
ALTER TABLE `fee_payments` ADD CONSTRAINT `fee_payments_gateway_ref_uq` UNIQUE(`gateway_ref`);