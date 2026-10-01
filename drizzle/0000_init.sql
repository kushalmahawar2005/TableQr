CREATE TABLE `plans` (
	`code` varchar(20) NOT NULL,
	`name` varchar(40) NOT NULL,
	`monthly_price_paise` int,
	`features` json NOT NULL,
	`is_public` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `plans_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `platform_admins` (
	`id` char(36) NOT NULL,
	`email` varchar(160) NOT NULL,
	`name` varchar(80) NOT NULL,
	`password_hash` varchar(255),
	`role` enum('super_admin','support') NOT NULL DEFAULT 'support',
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `platform_admins_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_admins_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`logo_url` varchar(500),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `brands_id` PRIMARY KEY(`id`),
	CONSTRAINT `brands_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `outlets` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`brand_id` char(36) NOT NULL,
	`code` varchar(12) NOT NULL,
	`name` varchar(120) NOT NULL,
	`city` varchar(80) NOT NULL,
	`address` varchar(300) NOT NULL,
	`gstin` varchar(15),
	`fssai` varchar(14),
	`timezone` varchar(40) NOT NULL DEFAULT 'Asia/Kolkata',
	`accent_color` varchar(7),
	`opening_hours` json,
	`session_mode` enum('open','verified','host_confirmed') NOT NULL DEFAULT 'open',
	`auto_accept_orders` boolean NOT NULL DEFAULT false,
	`new_session_cap_paise` int NOT NULL DEFAULT 300000,
	`sold_out_display` enum('hide','grey') NOT NULL DEFAULT 'grey',
	`idle_close_minutes` int NOT NULL DEFAULT 240,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `outlets_id` PRIMARY KEY(`id`),
	CONSTRAINT `outlets_code_uq` UNIQUE(`code`),
	CONSTRAINT `outlets_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_roles` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`outlet_id` char(36),
	`role` enum('owner','manager','cashier','host','waiter','kitchen','accountant') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `staff_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`plan_code` varchar(20) NOT NULL,
	`billing_cycle` enum('monthly','annual') NOT NULL DEFAULT 'monthly',
	`price_per_outlet_paise` int NOT NULL,
	`outlet_count` int NOT NULL DEFAULT 1,
	`status` enum('trial','active','past_due','cancelled') NOT NULL DEFAULT 'trial',
	`period_start` datetime(3) NOT NULL,
	`period_end` datetime(3) NOT NULL,
	`cancelled_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`plan_code` varchar(20) NOT NULL,
	`status` enum('trial','active','suspended','cancelled') NOT NULL DEFAULT 'trial',
	`status_reason` varchar(200),
	`trial_ends_at` datetime(3),
	`contact_name` varchar(80) NOT NULL,
	`contact_phone` varchar(15) NOT NULL,
	`contact_email` varchar(160),
	`billing_gstin` varchar(15),
	`billing_address` varchar(300),
	`created_by_admin_id` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`name` varchar(80) NOT NULL,
	`pin_hash` varchar(255),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_tenant_phone_uq` UNIQUE(`tenant_id`,`phone`),
	CONSTRAINT `users_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `dining_tables` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`zone_id` char(36) NOT NULL,
	`code` varchar(12) NOT NULL,
	`min_seats` int NOT NULL DEFAULT 1,
	`max_seats` int NOT NULL,
	`table_class` varchar(20) NOT NULL,
	`shape` enum('square','round','long') NOT NULL DEFAULT 'square',
	`pos_x` int NOT NULL DEFAULT 0,
	`pos_y` int NOT NULL DEFAULT 0,
	`width` int NOT NULL DEFAULT 2,
	`height` int NOT NULL DEFAULT 2,
	`combinable_with` json,
	`state` enum('available','held','reserved','seated','bill_requested','paid','needs_cleaning','blocked') NOT NULL DEFAULT 'available',
	`join_code` char(4) NOT NULL,
	`is_bookable_online` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `dining_tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `dining_tables_outlet_code_uq` UNIQUE(`outlet_id`,`code`),
	CONSTRAINT `dining_tables_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `qr_codes` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`table_id` char(36),
	`type` enum('table','entrance','booking') NOT NULL,
	`short_code` varchar(12) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `qr_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `qr_codes_outlet_short_uq` UNIQUE(`outlet_id`,`short_code`)
);
--> statement-breakpoint
CREATE TABLE `zones` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`name` varchar(60) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `zones_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `menu_categories` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`brand_id` char(36) NOT NULL,
	`name_en` varchar(80) NOT NULL,
	`name_hi` varchar(80),
	`available_from` time,
	`available_to` time,
	`image_url` varchar(500),
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `menu_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `menu_categories_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`brand_id` char(36) NOT NULL,
	`category_id` char(36) NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_hi` varchar(100),
	`description_en` varchar(300),
	`description_hi` varchar(300),
	`price_paise` int NOT NULL,
	`tax_rate_bp` int NOT NULL DEFAULT 500,
	`is_veg` boolean NOT NULL,
	`is_jain` boolean NOT NULL DEFAULT false,
	`spice_level` tinyint,
	`allergens` json,
	`search_terms` varchar(300),
	`prep_minutes` int NOT NULL DEFAULT 15,
	`station` varchar(30) NOT NULL,
	`tags` json,
	`image_url` varchar(500),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `menu_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `menu_items_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `modifier_groups` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`name_en` varchar(80) NOT NULL,
	`name_hi` varchar(80),
	`min_select` int NOT NULL DEFAULT 0,
	`max_select` int NOT NULL DEFAULT 1,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `modifier_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `modifier_groups_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `modifiers` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`group_id` char(36) NOT NULL,
	`name_en` varchar(80) NOT NULL,
	`name_hi` varchar(80),
	`price_delta_paise` int NOT NULL DEFAULT 0,
	`is_available` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `modifiers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outlet_item_overrides` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`price_paise` int,
	`is_available` boolean NOT NULL DEFAULT true,
	`sold_out_until` datetime(3),
	`portions_left` int,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `outlet_item_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `outlet_item_overrides_uq` UNIQUE(`outlet_id`,`item_id`)
);
--> statement-breakpoint
CREATE TABLE `cart_lines` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`participant_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`qty` int NOT NULL DEFAULT 1,
	`modifiers` json,
	`note` varchar(140),
	`shared_with` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `cart_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guests` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`name` varchar(80),
	`consent_marketing` boolean NOT NULL DEFAULT false,
	`consent_personalisation` boolean NOT NULL DEFAULT false,
	`consent_version` varchar(20),
	`consent_at` datetime(3),
	`dietary_flags` json,
	`no_show_count` int NOT NULL DEFAULT 0,
	`first_seen_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3),
	CONSTRAINT `guests_id` PRIMARY KEY(`id`),
	CONSTRAINT `guests_tenant_phone_uq` UNIQUE(`tenant_id`,`phone`),
	CONSTRAINT `guests_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `otp_challenges` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`table_id` char(36) NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expires_at` datetime(3) NOT NULL,
	`resend_at` datetime(3) NOT NULL,
	`locked_until` datetime(3),
	`verified_at` datetime(3),
	`dead_at` datetime(3),
	`guest_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `otp_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `otp_challenges_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`guest_id` char(36),
	`display_name` varchar(40) NOT NULL,
	`device_id` varchar(64),
	`added_by_user_id` char(36),
	`joined_at` datetime(3) NOT NULL,
	`paid_out_at` datetime(3),
	`removed_at` datetime(3),
	CONSTRAINT `participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `participants_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `table_sessions` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`table_id` char(36) NOT NULL,
	`mode` enum('open','verified','host_confirmed') NOT NULL,
	`status` enum('open','bill_requested','closed') NOT NULL DEFAULT 'open',
	`host_participant_id` char(36),
	`ordering_locked` boolean NOT NULL DEFAULT false,
	`open_key` char(36),
	`opened_at` datetime(3) NOT NULL,
	`last_activity_at` datetime(3) NOT NULL,
	`closed_at` datetime(3),
	CONSTRAINT `table_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `table_sessions_open_key_uq` UNIQUE(`open_key`),
	CONSTRAINT `table_sessions_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`order_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`participant_id` char(36),
	`item_id` char(36) NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_hi` varchar(100),
	`modifiers` json,
	`unit_price_paise` int NOT NULL,
	`qty` int NOT NULL,
	`tax_rate_bp` int NOT NULL,
	`station` varchar(30) NOT NULL,
	`note` varchar(140),
	`shared_with` json,
	`status` enum('placed','accepted','preparing','ready','served','cancelled','voided') NOT NULL DEFAULT 'placed',
	`void_reason` varchar(200),
	`voided_by_user_id` char(36),
	`ready_at` datetime(3),
	`served_at` datetime(3),
	`voided_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `order_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_lines_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`round_no` int NOT NULL,
	`placed_by_participant_id` char(36),
	`placed_by_user_id` char(36),
	`status` enum('placed','accepted','preparing','ready','served','cancelled') NOT NULL DEFAULT 'placed',
	`note` varchar(140),
	`client_request_id` varchar(64),
	`placed_at` datetime(3) NOT NULL,
	`accepted_at` datetime(3),
	`ready_at` datetime(3),
	`served_at` datetime(3),
	`cancelled_at` datetime(3),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_session_round_uq` UNIQUE(`session_id`,`round_no`),
	CONSTRAINT `orders_request_uq` UNIQUE(`tenant_id`,`session_id`,`client_request_id`),
	CONSTRAINT `orders_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `service_requests` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`table_id` char(36) NOT NULL,
	`participant_id` char(36),
	`kind` enum('water','cutlery','call_waiter','clean_table','request_bill') NOT NULL,
	`status` enum('open','done') NOT NULL DEFAULT 'open',
	`created_at` datetime(3) NOT NULL,
	`done_at` datetime(3),
	`done_by_user_id` char(36),
	CONSTRAINT `service_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`order_id` char(36) NOT NULL,
	`station` varchar(30) NOT NULL,
	`status` enum('new','in_progress','done') NOT NULL DEFAULT 'new',
	`printed_at` datetime(3),
	`bumped_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bill_shares` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`bill_id` char(36) NOT NULL,
	`participant_id` char(36),
	`amount_paise` int NOT NULL,
	`paid_paise` int NOT NULL DEFAULT 0,
	`tip_paise` int NOT NULL DEFAULT 0,
	`status` enum('unpaid','paid') NOT NULL DEFAULT 'unpaid',
	`paid_by_participant_id` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `bill_shares_id` PRIMARY KEY(`id`),
	CONSTRAINT `bill_shares_participant_uq` UNIQUE(`bill_id`,`participant_id`),
	CONSTRAINT `bill_shares_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`split_mode` enum('my_items','equal','custom') NOT NULL DEFAULT 'my_items',
	`subtotal_paise` int NOT NULL DEFAULT 0,
	`discount_paise` int NOT NULL DEFAULT 0,
	`tax_paise` int NOT NULL DEFAULT 0,
	`service_charge_paise` int NOT NULL DEFAULT 0,
	`tip_paise` int NOT NULL DEFAULT 0,
	`round_off_paise` int NOT NULL DEFAULT 0,
	`total_paise` int NOT NULL DEFAULT 0,
	`tax_breakup` json,
	`status` enum('open','locked','paid','cancelled') NOT NULL DEFAULT 'open',
	`requested_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`closed_at` datetime(3),
	CONSTRAINT `bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `bills_session_uq` UNIQUE(`session_id`),
	CONSTRAINT `bills_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_notes` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`invoice_id` char(36) NOT NULL,
	`number` varchar(30) NOT NULL,
	`amount_paise` int NOT NULL,
	`reason` varchar(200) NOT NULL,
	`by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `credit_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_notes_number_uq` UNIQUE(`outlet_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `discounts` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`bill_id` char(36) NOT NULL,
	`order_line_id` char(36),
	`kind` enum('percent','flat','complimentary') NOT NULL,
	`value` int NOT NULL,
	`amount_paise` int NOT NULL,
	`reason` varchar(200) NOT NULL,
	`applied_by_user_id` char(36) NOT NULL,
	`approved_by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `discounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`participant_id` char(36),
	`rating` tinyint NOT NULL,
	`comment` varchar(500),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_series` (
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`financial_year` varchar(5) NOT NULL,
	`last_seq` int NOT NULL DEFAULT 0,
	CONSTRAINT `invoice_series_outlet_id_financial_year_pk` PRIMARY KEY(`outlet_id`,`financial_year`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`bill_id` char(36) NOT NULL,
	`share_id` char(36),
	`financial_year` varchar(5) NOT NULL,
	`seq` int NOT NULL,
	`number` varchar(30) NOT NULL,
	`customer_gstin` varchar(15),
	`customer_name` varchar(120),
	`snapshot` json NOT NULL,
	`total_paise` int NOT NULL,
	`issued_at` datetime(3) NOT NULL,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_outlet_fy_seq_uq` UNIQUE(`outlet_id`,`financial_year`,`seq`),
	CONSTRAINT `invoices_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36) NOT NULL,
	`bill_id` char(36) NOT NULL,
	`allocations` json NOT NULL,
	`payer_participant_id` char(36),
	`method` enum('upi','card','wallet','cash') NOT NULL,
	`channel` varchar(30) NOT NULL,
	`gateway_ref` varchar(100),
	`amount_paise` int NOT NULL,
	`tip_paise` int NOT NULL DEFAULT 0,
	`status` enum('initiated','pending','success','failed','refunded') NOT NULL DEFAULT 'initiated',
	`failure_reason` varchar(200),
	`taken_by_user_id` char(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_gateway_ref_uq` UNIQUE(`channel`,`gateway_ref`),
	CONSTRAINT `payments_tenant_key` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`payment_id` char(36) NOT NULL,
	`amount_paise` int NOT NULL,
	`reason` varchar(200) NOT NULL,
	`by_user_id` char(36),
	`status` enum('pending','success','failed') NOT NULL DEFAULT 'pending',
	`gateway_ref` varchar(100),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` char(36) NOT NULL,
	`tenant_id` char(36) NOT NULL,
	`outlet_id` char(36),
	`actor_user_id` char(36),
	`actor_label` varchar(80) NOT NULL,
	`action` varchar(60) NOT NULL,
	`entity` varchar(40) NOT NULL,
	`entity_id` char(36),
	`before` json,
	`after` json,
	`reason` varchar(200),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `brands` ADD CONSTRAINT `brands_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outlets` ADD CONSTRAINT `outlets_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outlets` ADD CONSTRAINT `fk_outlets_brand` FOREIGN KEY (`tenant_id`,`brand_id`) REFERENCES `brands`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_roles` ADD CONSTRAINT `fk_staff_roles_user` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_roles` ADD CONSTRAINT `fk_staff_roles_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_code_plans_code_fk` FOREIGN KEY (`plan_code`) REFERENCES `plans`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_plan_code_plans_code_fk` FOREIGN KEY (`plan_code`) REFERENCES `plans`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_created_by_admin_id_platform_admins_id_fk` FOREIGN KEY (`created_by_admin_id`) REFERENCES `platform_admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dining_tables` ADD CONSTRAINT `fk_dining_tables_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dining_tables` ADD CONSTRAINT `fk_dining_tables_zone` FOREIGN KEY (`tenant_id`,`zone_id`) REFERENCES `zones`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qr_codes` ADD CONSTRAINT `fk_qr_codes_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qr_codes` ADD CONSTRAINT `fk_qr_codes_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `zones` ADD CONSTRAINT `fk_zones_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_categories` ADD CONSTRAINT `fk_menu_categories_brand` FOREIGN KEY (`tenant_id`,`brand_id`) REFERENCES `brands`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `fk_menu_items_brand` FOREIGN KEY (`tenant_id`,`brand_id`) REFERENCES `brands`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `fk_menu_items_category` FOREIGN KEY (`tenant_id`,`category_id`) REFERENCES `menu_categories`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_groups` ADD CONSTRAINT `fk_modifier_groups_item` FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifiers` ADD CONSTRAINT `fk_modifiers_group` FOREIGN KEY (`tenant_id`,`group_id`) REFERENCES `modifier_groups`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outlet_item_overrides` ADD CONSTRAINT `fk_overrides_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outlet_item_overrides` ADD CONSTRAINT `fk_overrides_item` FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_lines` ADD CONSTRAINT `fk_cart_lines_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_lines` ADD CONSTRAINT `fk_cart_lines_participant` FOREIGN KEY (`tenant_id`,`participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_lines` ADD CONSTRAINT `fk_cart_lines_item` FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guests` ADD CONSTRAINT `guests_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `otp_challenges` ADD CONSTRAINT `fk_otp_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `otp_challenges` ADD CONSTRAINT `fk_otp_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `otp_challenges` ADD CONSTRAINT `fk_otp_guest` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `participants` ADD CONSTRAINT `fk_participants_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `participants` ADD CONSTRAINT `fk_participants_guest` FOREIGN KEY (`tenant_id`,`guest_id`) REFERENCES `guests`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `participants` ADD CONSTRAINT `fk_participants_added_by` FOREIGN KEY (`tenant_id`,`added_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `table_sessions` ADD CONSTRAINT `fk_sessions_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `table_sessions` ADD CONSTRAINT `fk_sessions_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `fk_order_lines_order` FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `orders`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `fk_order_lines_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `fk_order_lines_participant` FOREIGN KEY (`tenant_id`,`participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `fk_order_lines_item` FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `fk_order_lines_voided_by` FOREIGN KEY (`tenant_id`,`voided_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_participant` FOREIGN KEY (`tenant_id`,`placed_by_participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`tenant_id`,`placed_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_requests` ADD CONSTRAINT `fk_service_requests_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_requests` ADD CONSTRAINT `fk_service_requests_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_requests` ADD CONSTRAINT `fk_service_requests_table` FOREIGN KEY (`tenant_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_requests` ADD CONSTRAINT `fk_service_requests_participant` FOREIGN KEY (`tenant_id`,`participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_requests` ADD CONSTRAINT `fk_service_requests_done_by` FOREIGN KEY (`tenant_id`,`done_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `fk_tickets_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `fk_tickets_order` FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `orders`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_shares` ADD CONSTRAINT `fk_bill_shares_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_shares` ADD CONSTRAINT `fk_bill_shares_participant` FOREIGN KEY (`tenant_id`,`participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_shares` ADD CONSTRAINT `fk_bill_shares_paid_by` FOREIGN KEY (`tenant_id`,`paid_by_participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `fk_bills_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `fk_bills_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `fk_credit_notes_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `fk_credit_notes_invoice` FOREIGN KEY (`tenant_id`,`invoice_id`) REFERENCES `invoices`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `fk_credit_notes_by` FOREIGN KEY (`tenant_id`,`by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discounts` ADD CONSTRAINT `fk_discounts_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discounts` ADD CONSTRAINT `fk_discounts_order_line` FOREIGN KEY (`tenant_id`,`order_line_id`) REFERENCES `order_lines`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discounts` ADD CONSTRAINT `fk_discounts_applied_by` FOREIGN KEY (`tenant_id`,`applied_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `discounts` ADD CONSTRAINT `fk_discounts_approved_by` FOREIGN KEY (`tenant_id`,`approved_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `fk_feedback_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `fk_feedback_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `table_sessions`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `fk_feedback_participant` FOREIGN KEY (`tenant_id`,`participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_series` ADD CONSTRAINT `fk_invoice_series_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `fk_invoices_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `fk_invoices_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `fk_invoices_share` FOREIGN KEY (`tenant_id`,`share_id`) REFERENCES `bill_shares`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_outlet` FOREIGN KEY (`tenant_id`,`outlet_id`) REFERENCES `outlets`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_bill` FOREIGN KEY (`tenant_id`,`bill_id`) REFERENCES `bills`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_payer` FOREIGN KEY (`tenant_id`,`payer_participant_id`) REFERENCES `participants`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_taken_by` FOREIGN KEY (`tenant_id`,`taken_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_payment` FOREIGN KEY (`tenant_id`,`payment_id`) REFERENCES `payments`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_by` FOREIGN KEY (`tenant_id`,`by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `subscriptions_tenant_idx` ON `subscriptions` (`tenant_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `tenants_status_idx` ON `tenants` (`status`);--> statement-breakpoint
CREATE INDEX `menu_items_brand_idx` ON `menu_items` (`tenant_id`,`brand_id`);--> statement-breakpoint
CREATE INDEX `otp_challenges_phone_idx` ON `otp_challenges` (`tenant_id`,`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `otp_challenges_device_idx` ON `otp_challenges` (`tenant_id`,`device_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `otp_challenges_table_idx` ON `otp_challenges` (`tenant_id`,`table_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `participants_device_idx` ON `participants` (`device_id`);--> statement-breakpoint
CREATE INDEX `table_sessions_outlet_idx` ON `table_sessions` (`outlet_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `orders_outlet_placed_idx` ON `orders` (`outlet_id`,`placed_at`);--> statement-breakpoint
CREATE INDEX `service_requests_outlet_status_idx` ON `service_requests` (`outlet_id`,`status`);--> statement-breakpoint
CREATE INDEX `tickets_outlet_station_idx` ON `tickets` (`outlet_id`,`station`,`status`);--> statement-breakpoint
CREATE INDEX `bills_outlet_created_idx` ON `bills` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_outlet_created_idx` ON `feedback` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_outlet_created_idx` ON `payments` (`outlet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `audit_log_tenant_created_idx` ON `audit_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);