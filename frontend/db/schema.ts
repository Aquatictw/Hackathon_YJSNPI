import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const batches = sqliteTable("batches", {
  key: text("key").primaryKey(),
  edgeId: text("edge_id").notNull(),
  batchId: text("batch_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("uq_batches_edge_batch").on(table.edgeId, table.batchId)]);

export const runs = sqliteTable("runs", {
  key: text("key").primaryKey(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  edgeId: text("edge_id").notNull(),
  mode: text("mode").notNull(),
  archived: integer("archived").notNull().default(0),
  lotId: text("lot_id"),
  waferId: text("wafer_id"),
  dataQuality: text("data_quality").notNull().default("partial"),
  lastEventAt: text("last_event_at").notNull(),
  ...timestamps,
}, table => [
  uniqueIndex("uq_runs_tester_run").on(table.testerId, table.runId),
  index("idx_runs_last_event_at").on(table.lastEventAt),
]);

export const deletedRuns = sqliteTable("deleted_runs", {
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  deletedAt: text("deleted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [primaryKey({ columns: [table.runId, table.testerId] })]);

export const events = sqliteTable("events", {
  key: text("key").primaryKey(),
  eventId: text("event_id").notNull(),
  batchKey: text("batch_key").notNull(),
  edgeId: text("edge_id").notNull(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  lotId: text("lot_id"),
  waferId: text("wafer_id"),
  siteId: integer("site_id"),
  type: text("type").notNull(),
  mode: text("mode").notNull(),
  occurredAt: text("occurred_at").notNull(),
  sequence: integer("sequence"),
  incidentId: text("incident_id"),
  evidenceId: text("evidence_id"),
  payloadHash: text("payload_hash").notNull(),
  payload: text("payload").notNull(),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("uq_events_scope_event").on(table.runId, table.testerId, table.eventId),
  index("idx_events_run_time").on(table.runId, table.testerId, table.occurredAt),
  index("idx_events_incident").on(table.incidentId),
]);

export const rawEvents = sqliteTable("raw_events", {
  key: text("key").primaryKey(),
  eventId: text("event_id").notNull(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  edgeId: text("edge_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  payloadBytes: integer("payload_bytes").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("uq_raw_events_scope_event").on(table.runId, table.testerId, table.eventId),
  index("idx_raw_events_run_type").on(table.runId, table.testerId, table.eventType),
]);

export const rawEventChunks = sqliteTable("raw_event_chunks", {
  key: text("key").primaryKey(),
  eventKey: text("event_key").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  payloadBase64: text("payload_base64").notNull(),
}, table => [
  uniqueIndex("uq_raw_event_chunks_event_index").on(table.eventKey, table.chunkIndex),
]);

export const evidence = sqliteTable("evidence", {
  key: text("key").primaryKey(),
  evidenceId: text("evidence_id").notNull(),
  eventKey: text("event_key").notNull(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  incidentId: text("incident_id"),
  siteId: integer("site_id"),
  testName: text("test_name"),
  kind: text("kind"),
  sampleCount: integer("sample_count").notNull().default(0),
  observed: real("observed"),
  baseline: real("baseline"),
  score: real("score"),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("uq_evidence_scope_id").on(table.runId, table.testerId, table.evidenceId),
  index("idx_evidence_incident").on(table.incidentId),
]);

export const incidents = sqliteTable("incidents", {
  key: text("key").primaryKey(),
  incidentId: text("incident_id").notNull(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"),
  severity: text("severity").notNull().default("warning"),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
  ...timestamps,
}, table => [
  uniqueIndex("uq_incidents_scope_id").on(table.runId, table.testerId, table.incidentId),
  index("idx_incidents_run_status").on(table.runId, table.testerId, table.status),
]);

export const investigations = sqliteTable("investigations", {
  investigationId: text("investigation_id").primaryKey(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id"),
  incidentId: text("incident_id"),
  question: text("question").notNull(),
  status: text("status").notNull(),
  model: text("model"),
  answer: text("answer"),
  evidenceIds: text("evidence_ids").notNull().default("[]"),
  toolTrace: text("tool_trace").notNull().default("[]"),
  error: text("error"),
  ...timestamps,
}, table => [index("idx_investigations_run_created").on(table.runId, table.createdAt)]);

export const commands = sqliteTable("commands", {
  commandId: text("command_id").primaryKey(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  incidentId: text("incident_id").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("queued"),
  expiresAt: text("expires_at").notNull(),
  payloadHash: text("payload_hash").notNull(),
  ...timestamps,
}, table => [index("idx_commands_tester_status").on(table.testerId, table.status)]);

export const commandResults = sqliteTable("command_results", {
  ackId: text("ack_id").primaryKey(),
  commandId: text("command_id").notNull(),
  runId: text("run_id").notNull(),
  testerId: text("tester_id").notNull(),
  status: text("status").notNull(),
  testerReceiptId: text("tester_receipt_id"),
  detail: text("detail").notNull().default(""),
  occurredAt: text("occurred_at").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("idx_command_results_command").on(table.commandId, table.occurredAt)]);
