ALTER TABLE `tenants` ADD `custom_features` json;--> statement-breakpoint
ALTER TABLE `tenants` ADD `custom_price_paise` int;--> statement-breakpoint
-- Plans saved before these switches existed: Starter gets none of them, Growth gets all but full reports, higher plans get all
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.waiterApp', IF(`code` = 'starter', JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.waiterApp') IS NULL;--> statement-breakpoint
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.discounts', IF(`code` = 'starter', JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.discounts') IS NULL;--> statement-breakpoint
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.whatsappBills', IF(`code` = 'starter', JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.whatsappBills') IS NULL;--> statement-breakpoint
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.reservations', IF(`code` = 'starter', JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.reservations') IS NULL;--> statement-breakpoint
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.fullReports', IF(`code` IN ('starter', 'growth'), JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.fullReports') IS NULL;--> statement-breakpoint
-- The Custom plan: the platform admin ticks features and sets the price for each restaurant on it
INSERT INTO `plans` (`code`, `name`, `monthly_price_paise`, `features`, `is_public`, `sort_order`, `created_at`, `updated_at`) SELECT 'custom', 'Custom', NULL, '{"maxTables":5,"maxStaff":2,"poweredBy":true,"waiterApp":false,"discounts":false,"whatsappBills":false,"groupSplit":false,"reservations":false,"kitchenDisplay":false,"pricingRules":false,"fullReports":false,"multiOutlet":false}', 1, 99, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `plans` WHERE `code` = 'custom');--> statement-breakpoint
-- New plan names, only where the admin has not renamed them already
UPDATE `plans` SET `name` = 'Lite' WHERE `code` = 'starter' AND `name` = 'Starter';--> statement-breakpoint
UPDATE `plans` SET `name` = 'Plus' WHERE `code` = 'growth' AND `name` = 'Growth';
