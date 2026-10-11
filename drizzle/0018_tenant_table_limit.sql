ALTER TABLE `tenants` ADD `table_limit` int;--> statement-breakpoint
-- Restaurants that already exist keep exactly the tables they run today as their limit
UPDATE `tenants` t SET `table_limit` = GREATEST(1, (SELECT COUNT(*) FROM `dining_tables` d WHERE d.`tenant_id` = t.`id` AND d.`is_active` = 1)) WHERE t.`table_limit` IS NULL;
