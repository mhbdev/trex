CREATE TABLE `managed_run_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`profile_id` text NOT NULL,
	`state` text NOT NULL,
	`phase` text NOT NULL,
	`message` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`symbols_json` text NOT NULL,
	`strategy_ids_json` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `managed_run_attempts_started_idx` ON `managed_run_attempts` (`started_at`);
