CREATE TABLE `decision_memories` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`context_key` text NOT NULL,
	`action` text NOT NULL,
	`decision_text` text NOT NULL,
	`entry_reference_price` text NOT NULL,
	`benchmark_symbol` text NOT NULL,
	`decided_at` integer NOT NULL,
	`holding_period_bars` integer NOT NULL,
	`due_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`entry_price` text,
	`exit_price` text,
	`benchmark_entry_price` text,
	`benchmark_exit_price` text,
	`raw_return` text,
	`benchmark_return` text,
	`alpha_return` text,
	`resolved_at` integer,
	`reflection` text,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decision_memories_pending_due_idx` ON `decision_memories` (`context_key`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `decision_memories_lessons_idx` ON `decision_memories` (`context_key`,`status`,`resolved_at`,`symbol`);