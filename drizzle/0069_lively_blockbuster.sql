ALTER TABLE `outlets` MODIFY COLUMN `guest_pwa_install_enabled` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE `outlets` SET `guest_pwa_install_enabled` = false;
