CREATE TABLE `checkpoints` (
	`run_id` text NOT NULL,
	`key` text NOT NULL,
	`payload_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `key`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`decided_at` integer NOT NULL,
	`quote_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`findings_json` text NOT NULL,
	`proposal_json` text NOT NULL,
	`risk_json` text NOT NULL,
	`order_client_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_client_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` text NOT NULL,
	`price` text NOT NULL,
	`fee` text NOT NULL,
	`fee_asset` text NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`order_client_id`) REFERENCES `order_intents`(`client_order_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_intents` (
	`client_order_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`order_json` text NOT NULL,
	`state` text NOT NULL,
	`exchange_order_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`cash` text NOT NULL,
	`equity` text NOT NULL,
	`positions_json` text NOT NULL,
	`high_watermark` text NOT NULL,
	`realized_pnl_today` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reflections` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `risk_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`approved` integer NOT NULL,
	`reasons_json` text NOT NULL,
	`result_json` text NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`config_json` text NOT NULL,
	`git_revision` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`report_json` text
);
--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`symbol` text NOT NULL,
	`observed_at` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
