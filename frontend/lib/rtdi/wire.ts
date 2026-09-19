import { z } from "zod";

const id = z.string().min(1).max(120);
const finite = z.number().finite();
const timestamp = z.string().datetime({ offset: true });
const siteId = z.number().int().min(1).max(256);

export const edgeRecordSchema = z.object({
  event_id: id,
  type: z.enum(["measurement", "prediction", "prediction_actual", "evidence", "heartbeat", "run_summary"]),
  source_mode: z.enum(["live", "replay", "simulation"]),
  run_id: id,
  tester_id: id,
  lot_id: id.optional(),
  wafer_id: id.optional(),
  device_id: id.optional(),
  site_id: siteId.optional(),
  site_ids: z.array(siteId).max(256).optional(),
  timestamp,
  sequence: z.number().int().nonnegative().optional(),
  attempt: z.number().int().positive().optional(),
  test_number: z.number().int().optional(),
  test_name: z.string().min(1).max(240).optional(),
  pin: z.string().max(120).optional(),
  value: finite.optional(),
  unit: z.string().max(32).nullable().optional(),
  quality: z.string().max(32).optional(),
  request_id: id.optional(),
  original_request_id: id.optional(),
  source_event_id: id.optional(),
  stage: z.number().int().min(1).max(6).optional(),
  prediction: finite.nullable().optional(),
  actual: finite.optional(),
  absolute_error: finite.nonnegative().optional(),
  model_version: id.optional(),
  feature_cutoff: z.number().int().optional(),
  latency_ms: finite.nonnegative().optional(),
  coverage: finite.min(0).max(1).optional(),
  response_status: z.enum(["not_requested", "insufficient_data", "response_queued", "tester_confirmed", "unknown"]).optional(),
  tester_receipt_id: id.nullable().optional(),
  evidence_id: id.optional(),
  incident_id: id.optional(),
  kind: z.string().min(1).max(80).optional(),
  direction: z.string().max(32).optional(),
  sample_count: z.number().int().nonnegative().optional(),
  score: finite.optional(),
  baseline: finite.optional(),
  current_value: finite.optional(),
  threshold: finite.optional(),
  affected_tests: z.array(z.string().min(1).max(240)).max(40).optional(),
  series: z.array(finite).max(320).optional(),
  site_series: z.record(z.string(), z.array(finite).max(320)).optional(),
  suggestion: z.string().max(1000).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  message: z.string().max(2000).optional(),
  completed_devices: z.number().int().nonnegative().optional(),
  yield: finite.min(0).max(1).optional(),
  data_quality: z.enum(["complete", "partial"]).optional(),
  queue_depth: z.number().int().nonnegative().optional(),
  version: z.string().max(120).optional(),
}).strict().superRefine((record, ctx) => {
  const missing = (field: keyof typeof record) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${record.type} requires ${field}` });
  if (record.type === "measurement") {
    if (record.value === undefined) missing("value");
    if (!record.test_name) missing("test_name");
  }
  if (record.type === "prediction") {
    if (!record.request_id) missing("request_id");
    if (!record.stage) missing("stage");
    if (!record.device_id) missing("device_id");
  }
  if (record.type === "prediction_actual") {
    if (!record.request_id) missing("request_id");
    if (record.actual === undefined) missing("actual");
  }
  if (record.type === "evidence" && !record.evidence_id) missing("evidence_id");
  if (record.response_status === "tester_confirmed" && !record.tester_receipt_id) missing("tester_receipt_id");
});

export const edgeBatchSchema = z.object({
  schema_version: z.literal(1),
  edge_id: id,
  batch_id: id,
  sent_at: timestamp.optional(),
  events: z.array(edgeRecordSchema).min(1).max(100),
}).strict().superRefine((batch, ctx) => {
  const seen = new Set<string>();
  const evidenceSeen = new Set<string>();
  for (const [index, event] of batch.events.entries()) {
    const scopedId = JSON.stringify([event.run_id, event.tester_id, event.event_id]);
    if (seen.has(scopedId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events", index, "event_id"], message: "duplicate scoped event_id in batch" });
    seen.add(scopedId);
    if (event.evidence_id) {
      const scopedEvidenceId = JSON.stringify([event.run_id, event.tester_id, event.evidence_id]);
      if (evidenceSeen.has(scopedEvidenceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events", index, "evidence_id"], message: "duplicate scoped evidence_id in batch" });
      evidenceSeen.add(scopedEvidenceId);
    }
  }
});

export type EdgeRecord = z.infer<typeof edgeRecordSchema>;
export type EdgeBatch = z.infer<typeof edgeBatchSchema>;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
