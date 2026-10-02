// Repairs the local pre-S1 checkout's prematurely applied S3 draft, without resetting data.
// Only the two named local databases are accepted. Normal installations use db:migrate.
import fs from "node:fs";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
const database=process.argv[2];
if(!["tableqr","tableqr_test"].includes(database))throw new Error("Choose local tableqr or tableqr_test");
const conn=await mysql.createConnection({host:"127.0.0.1",port:3306,user:"tableqr",password:"tableqr_local",database});
try {
 const journal=JSON.parse(fs.readFileSync("drizzle/meta/_journal.json","utf8"));
 const [applied]=await conn.query("SELECT * FROM __drizzle_migrations");
 for(const entry of journal.entries){
  const source=fs.readFileSync(`drizzle/${entry.tag}.sql`,"utf8");
  const hash=crypto.createHash("sha256").update(source).digest("hex");
  const old=applied.find(a=>Number(a.created_at)===entry.when);
  if(old?.hash===hash)continue;
  if(old){
   if(entry.tag!=="0007_s3_waiter"||old.hash!=="a49f33282e6cc005527fcbd38eec4ac8e81125a1c732a03766147a2850d77f5d")throw new Error(`Unexpected migration drift: ${entry.tag}`);
   const [cols]=await conn.query("SHOW COLUMNS FROM waiter_table_assignments");
   if(!cols.some(c=>c.Field==="active_key"))await conn.query("ALTER TABLE waiter_table_assignments ADD COLUMN active_key char(36) NULL, ADD COLUMN expires_at datetime(3) NULL");
   await conn.query("UPDATE waiter_table_assignments SET expires_at = DATE_ADD(assigned_at, INTERVAL 12 HOUR) WHERE expires_at IS NULL");
   await conn.query("ALTER TABLE waiter_table_assignments MODIFY expires_at datetime(3) NOT NULL");
   const [duplicates]=await conn.query("SELECT table_id FROM waiter_table_assignments WHERE active = true GROUP BY tenant_id, table_id HAVING COUNT(*) > 1");
   if(duplicates.length)throw new Error("Resolve duplicate live assignments before adding the uniqueness constraint");
   await conn.query("UPDATE waiter_table_assignments SET active_key = CASE WHEN active THEN table_id ELSE NULL END");
   const [indexes]=await conn.query("SHOW INDEX FROM waiter_table_assignments WHERE Key_name = 'waiter_assignments_active_uq'");
   if(!indexes.length)await conn.query("CREATE UNIQUE INDEX waiter_assignments_active_uq ON waiter_table_assignments (tenant_id, active_key)");
   await conn.query("UPDATE __drizzle_migrations SET hash = ? WHERE id = ?",[hash,old.id]);
  } else {
   for(const statement of source.split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean))await conn.query(statement);
   await conn.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",[hash,entry.when]);
  }
  console.log(`${database}: reconciled ${entry.tag}`);
 }
} finally {await conn.end();}
