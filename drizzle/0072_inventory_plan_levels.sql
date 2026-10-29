UPDATE plans SET features = JSON_SET(features, '$.purchasing', CAST('false' AS JSON), '$.recipeCosting', CAST('false' AS JSON)) WHERE code = 'starter';
--> statement-breakpoint
UPDATE plans SET features = JSON_SET(features, '$.purchasing', CAST('true' AS JSON), '$.recipeCosting', CAST('false' AS JSON)) WHERE code = 'growth';
--> statement-breakpoint
UPDATE plans SET features = JSON_SET(features, '$.purchasing', CAST('true' AS JSON), '$.recipeCosting', CAST('true' AS JSON)) WHERE code = 'pro';
