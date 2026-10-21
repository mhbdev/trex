CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config_profile_secrets` (
	`profile_id` text NOT NULL,
	`secret_key` text NOT NULL,
	`algorithm` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`nonce` text NOT NULL,
	`ciphertext` text NOT NULL,
	`auth_tag` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `secret_key`),
	FOREIGN KEY (`profile_id`) REFERENCES `config_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `config_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`settings_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_profiles_name_unique` ON `config_profiles` (`name`);