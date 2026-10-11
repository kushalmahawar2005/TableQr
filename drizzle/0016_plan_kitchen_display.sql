-- The kitchen display (KDS) becomes a plan feature: off on Starter and Growth, on for every other plan.
-- Only adds the key where it is missing, so a choice made later in admin > Plans is never overwritten.
UPDATE `plans` SET `features` = JSON_SET(`features`, '$.kitchenDisplay', CAST(IF(`code` IN ('starter', 'growth'), 'false', 'true') AS JSON)) WHERE JSON_EXTRACT(`features`, '$.kitchenDisplay') IS NULL;
