CREATE INDEX `decisions_run_symbol_time_idx` ON `decisions` (`run_id`,`symbol`,`decided_at`);--> statement-breakpoint
CREATE INDEX `fills_order_time_idx` ON `fills` (`order_client_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `order_intents_run_state_time_idx` ON `order_intents` (`run_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `portfolio_snapshots_run_time_idx` ON `portfolio_snapshots` (`run_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `portfolio_snapshots_key_time_idx` ON `portfolio_snapshots` (`portfolio_key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `reflections_scope_time_idx` ON `reflections` (`context_key`,`symbol`,`created_at`);--> statement-breakpoint
CREATE INDEX `risk_outcomes_decision_time_idx` ON `risk_outcomes` (`decision_id`,`checked_at`);--> statement-breakpoint
CREATE INDEX `source_snapshots_run_category_time_idx` ON `source_snapshots` (`run_id`,`category`,`observed_at`);