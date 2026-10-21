CREATE TABLE `ai_model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`decision_id` text,
	`symbol` text NOT NULL,
	`role` text NOT NULL,
	`operation` text NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`total_tokens` integer,
	`finish_reason` text,
	`response_id` text,
	`tool_names_json` text NOT NULL,
	`warnings_json` text NOT NULL,
	`error_name` text,
	`error_message` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_model_calls_operation_step_idx` ON `ai_model_calls` (`operation_id`,`step_number`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_time_idx` ON `ai_model_calls` (`run_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_role_idx` ON `ai_model_calls` (`run_id`,`role`,`started_at`);
