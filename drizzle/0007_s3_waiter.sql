CREATE TABLE `waiter_table_assignments` (
  `id` char(36) NOT NULL,
  `tenant_id` char(36) NOT NULL,
  `outlet_id` char(36) NOT NULL,
  `table_id` char(36) NOT NULL,
  `waiter_user_id` char(36) NOT NULL,
  `assigned_by_user_id` char(36) NOT NULL,
  `period_key` varchar(40) NOT NULL,
  `active_key` char(36),
  `expires_at` datetime(3) NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `assigned_at` datetime(3) NOT NULL,
  `released_at` datetime(3),
  CONSTRAINT `waiter_table_assignments_pk` PRIMARY KEY(`id`),
  CONSTRAINT `fk_waiter_assignments_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`),
  CONSTRAINT `fk_waiter_assignments_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`),
  CONSTRAINT `fk_waiter_assignments_waiter` FOREIGN KEY (`tenant_id`,`waiter_user_id`) REFERENCES `users`(`tenant_id`,`id`),
  CONSTRAINT `fk_waiter_assignments_assigned_by` FOREIGN KEY (`tenant_id`,`assigned_by_user_id`) REFERENCES `users`(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE INDEX `waiter_assignments_table_active_idx` ON `waiter_table_assignments` (`tenant_id`,`outlet_id`,`table_id`,`active`);
--> statement-breakpoint
CREATE INDEX `waiter_assignments_waiter_active_idx` ON `waiter_table_assignments` (`tenant_id`,`outlet_id`,`waiter_user_id`,`active`);
--> statement-breakpoint
CREATE UNIQUE INDEX `waiter_assignments_active_uq` ON `waiter_table_assignments` (`tenant_id`,`active_key`);
