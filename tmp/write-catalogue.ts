import { DEFAULT_PLANS } from '../src/lib/plan-features';
import { writeFileSync } from 'node:fs';
const quote = (s: string) => "'"+s.replaceAll("'","''")+"'";
let sql = `-- Preserve existing feature grants before refreshing the public catalogue.\nUPDATE tenants t JOIN plans p ON t.plan_code = p.code SET t.custom_features = p.features WHERE t.custom_features IS NULL AND t.commercial IS NULL AND p.code IN ('starter','growth','pro');\n--> statement-breakpoint\n`;
for(const p of DEFAULT_PLANS.filter(p=>['starter','growth','pro'].includes(p.code))) sql += `INSERT INTO plans (code,name,monthly_price_paise,features,is_public,sort_order,created_at,updated_at) VALUES (${quote(p.code)},${quote(p.name)},${p.monthlyPricePaise},${quote(JSON.stringify(p.features))},1,${p.sortOrder},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE name=VALUES(name),monthly_price_paise=VALUES(monthly_price_paise),features=VALUES(features),is_public=1,sort_order=VALUES(sort_order);\n--> statement-breakpoint\n`;
sql += "UPDATE plans SET is_public=0 WHERE code IN ('chain','hotel','hotel_plus');\n";
writeFileSync('drizzle/0071_agreed_plan_catalogue.sql',sql);
