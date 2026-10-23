CREATE TABLE `platform_admin_login_buckets` (
	`admin_key_hash` char(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`window_started_at` datetime(3) NOT NULL,
	`locked_until` datetime(3),
	CONSTRAINT `platform_admin_login_buckets_admin_key_hash` PRIMARY KEY(`admin_key_hash`)
);
