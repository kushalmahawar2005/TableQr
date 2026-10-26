CREATE TABLE `app_releases` (
	`id` char(36) NOT NULL,
	`app` enum('rider') NOT NULL,
	`version` varchar(20) NOT NULL,
	`url` varchar(500) NOT NULL,
	`size_bytes` int NOT NULL,
	`notes` varchar(300),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `app_releases_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_releases_app_version_uq` UNIQUE(`app`,`version`)
);
--> statement-breakpoint
INSERT INTO `app_releases` (`id`, `app`, `version`, `url`, `size_bytes`, `notes`, `created_at`) VALUES ('01a178ce-e9a0-70da-9d72-97364f7233f2', 'rider', '1.0.0', 'https://pub-f7ba82d1014b41699484b158efa4cbf1.r2.dev/apps/rider/TableQR-Rider-1.0.0.apk', 4545861, 'First release: live deliveries, background location with the screen off', NOW(3));