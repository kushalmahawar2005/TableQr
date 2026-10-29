UPDATE plans SET features = JSON_SET(features, '$.purchasing', JSON_EXTRACT('false', '$'), '$.recipeCosting', JSON_EXTRACT('false', '$')) WHERE code = 'starter';
--> statement-breakpoint
UPDATE plans SET features = JSON_SET(features, '$.purchasing', JSON_EXTRACT('true', '$'), '$.recipeCosting', JSON_EXTRACT('false', '$')) WHERE code = 'growth';
--> statement-breakpoint
UPDATE plans SET features = JSON_SET(features, '$.purchasing', JSON_EXTRACT('true', '$'), '$.recipeCosting', JSON_EXTRACT('true', '$')) WHERE code = 'pro';
