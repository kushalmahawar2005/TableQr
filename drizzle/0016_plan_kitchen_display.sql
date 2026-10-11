-- The kitchen display (KDS) becomes a plan feature: off on Starter and Growth, on for every other plan.
-- Only adds the key where it is missing, so a choice made later in admin > Plans is never overwritten.
-- JSON_EXTRACT('false', '$') gives a JSON boolean on both MySQL and MariaDB.
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.kitchenDisplay', IF(`code` IN ('starter', 'growth'), JSON_EXTRACT('false', '$'), JSON_EXTRACT('true', '$'))) WHERE JSON_EXTRACT(`features`, '$.kitchenDisplay') IS NULL;
