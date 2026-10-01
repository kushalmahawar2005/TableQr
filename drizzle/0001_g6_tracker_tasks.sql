ALTER TABLE `order_lines` ADD `prep_minutes` int DEFAULT 15 NOT NULL;--> statement-breakpoint
UPDATE `order_lines` AS `line`
INNER JOIN `menu_items` AS `item` ON `item`.`tenant_id` = `line`.`tenant_id` AND `item`.`id` = `line`.`item_id`
SET `line`.`prep_minutes` = GREATEST(1, `item`.`prep_minutes`);--> statement-breakpoint
ALTER TABLE `service_requests` ADD `client_request_id` varchar(64);--> statement-breakpoint
ALTER TABLE `service_requests` ADD `escalated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_request_uq` UNIQUE(`tenant_id`,`session_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `service_requests_session_kind_idx` ON `service_requests` (`tenant_id`,`session_id`,`kind`,`created_at`);
