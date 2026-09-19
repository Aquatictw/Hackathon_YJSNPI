CREATE TABLE `batches` (
	`key` text PRIMARY KEY NOT NULL,
	`edge_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_batches_edge_batch` ON `batches` (`edge_id`,`batch_id`);
--> statement-breakpoint
CREATE TABLE `runs` (
	`key` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text NOT NULL,
	`edge_id` text NOT NULL,
	`mode` text NOT NULL,
	`lot_id` text,
	`wafer_id` text,
	`data_quality` text DEFAULT 'partial' NOT NULL,
	`last_event_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_runs_tester_run` ON `runs` (`tester_id`,`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_runs_last_event_at` ON `runs` (`last_event_at`);
--> statement-breakpoint
CREATE TABLE `events` (
	`key` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`batch_key` text NOT NULL,
	`edge_id` text NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text NOT NULL,
	`lot_id` text,
	`wafer_id` text,
	`site_id` integer,
	`type` text NOT NULL,
	`mode` text NOT NULL,
	`occurred_at` text NOT NULL,
	`sequence` integer,
	`incident_id` text,
	`evidence_id` text,
	`payload_hash` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_events_scope_event` ON `events` (`run_id`,`tester_id`,`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_events_run_time` ON `events` (`run_id`,`tester_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_events_incident` ON `events` (`incident_id`);
--> statement-breakpoint
CREATE TABLE `raw_events` (
	`key` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text NOT NULL,
	`edge_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_bytes` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_raw_events_scope_event` ON `raw_events` (`run_id`,`tester_id`,`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_raw_events_run_type` ON `raw_events` (`run_id`,`tester_id`,`event_type`);
--> statement-breakpoint
CREATE TABLE `raw_event_chunks` (
	`key` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`payload_base64` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_raw_event_chunks_event_index` ON `raw_event_chunks` (`event_key`,`chunk_index`);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`key` text PRIMARY KEY NOT NULL,
	`evidence_id` text NOT NULL,
	`event_key` text NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text NOT NULL,
	`incident_id` text,
	`site_id` integer,
	`test_name` text,
	`kind` text,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`observed` real,
	`baseline` real,
	`score` real,
	`payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_evidence_scope_id` ON `evidence` (`run_id`,`tester_id`,`evidence_id`);
--> statement-breakpoint
CREATE INDEX `idx_evidence_incident` ON `evidence` (`incident_id`);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`key` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_incidents_scope_id` ON `incidents` (`run_id`,`tester_id`,`incident_id`);
--> statement-breakpoint
CREATE INDEX `idx_incidents_run_status` ON `incidents` (`run_id`,`tester_id`,`status`);
--> statement-breakpoint
CREATE TABLE `investigations` (
	`investigation_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text,
	`incident_id` text,
	`question` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`answer` text,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`tool_trace` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_investigations_run_created` ON `investigations` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `commands` (
	`command_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`expires_at` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_commands_tester_status` ON `commands` (`tester_id`,`status`);
--> statement-breakpoint
CREATE TABLE `command_results` (
	`ack_id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`run_id` text NOT NULL,
	`tester_id` text NOT NULL,
	`status` text NOT NULL,
	`tester_receipt_id` text,
	`detail` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_command_results_command` ON `command_results` (`command_id`,`occurred_at`);
