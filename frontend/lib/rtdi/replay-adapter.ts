import { z } from "zod";
import { edgeBatchSchema, type EdgeBatch, type EdgeRecord } from "./wire.ts";

const finite = z.number().finite();
const replayAlertSchema = z.object({
  kind: z.literal("alert"),
  mode: z.literal("replay"),
  wafer: z.union([z.string(), z.number()]),
  lot: z.union([z.string(), z.number()]),
  alert: z.object({
    kind: z.string().min(1),
    message: z.string().min(1),
    test: z.string().min(1),
    site: z.union([z.string(), z.number()]),
    completed_devices: z.number().int().nonnegative(),
    observed: finite,
    reference: finite,
    score: finite,
    series: z.array(finite).max(320),
    site_series: z.record(z.string(), z.array(finite).max(320)),
    suggestion: z.string().max(1000),
  }).passthrough(),
}).passthrough();

export type ReplayAdapterOptions = {
  edgeId: string;
  runId: string;
  testerId: string;
  startedAt: string;
};

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 8).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const optionalSiteId = (value: string | number): number | undefined => {
  const site = Number(value);
  return Number.isInteger(site) && site >= 1 && site <= 256 ? site : undefined;
};

const directionFor = (kind: string): string | undefined => {
  if (kind.endsWith("_up")) return "up";
  if (kind.endsWith("_down")) return "down";
  return undefined;
};

export async function replayJsonlToEdgeBatches(lines: string[], options: ReplayAdapterOptions): Promise<EdgeBatch[]> {
  const start = new Date(options.startedAt);
  if (Number.isNaN(start.getTime())) throw new Error("startedAt must be an ISO timestamp");
  const parsed = lines.filter(line => line.trim()).map((line, index) => {
    try { return replayAlertSchema.parse(JSON.parse(line)); }
    catch (error) { throw new Error(`Invalid replay JSONL line ${index + 1}: ${error instanceof Error ? error.message : "unknown error"}`); }
  });
  const runHash = await shortHash(`${options.edgeId}:${options.runId}:${options.testerId}`);
  const events: EdgeRecord[] = parsed.map((record, index) => {
    const sequence = index + 1;
    const timestamp = new Date(start.getTime() + index * 1000).toISOString();
    const siteId = optionalSiteId(record.alert.site);
    const siteIds = Object.keys(record.alert.site_series).map(Number).filter(site => Number.isInteger(site) && site >= 1 && site <= 256);
    return {
      event_id: `replay-${runHash}-event-${String(sequence).padStart(4, "0")}`,
      type: "evidence",
      source_mode: "replay",
      run_id: options.runId,
      tester_id: options.testerId,
      lot_id: String(record.lot),
      wafer_id: String(record.wafer),
      ...(siteId ? { site_id: siteId } : {}),
      ...(siteIds.length ? { site_ids: siteIds } : {}),
      timestamp,
      sequence,
      evidence_id: `replay-${runHash}-evidence-${String(sequence).padStart(4, "0")}`,
      incident_id: `replay-${runHash}-incident-${String(sequence).padStart(4, "0")}`,
      kind: record.alert.kind,
      ...(directionFor(record.alert.kind) ? { direction: directionFor(record.alert.kind) } : {}),
      sample_count: record.alert.completed_devices,
      score: record.alert.score,
      baseline: record.alert.reference,
      current_value: record.alert.observed,
      affected_tests: [record.alert.test],
      series: record.alert.series,
      site_series: record.alert.site_series,
      suggestion: record.alert.suggestion,
      severity: "warning",
      message: record.alert.message,
      completed_devices: record.alert.completed_devices,
      ...(record.alert.kind === "low_yield" ? { yield: record.alert.observed } : {}),
      data_quality: "partial",
    };
  });
  const batches: EdgeBatch[] = [];
  for (let offset = 0; offset < events.length; offset += 100) {
    const batchNumber = Math.floor(offset / 100) + 1;
    batches.push(edgeBatchSchema.parse({
      schema_version: 1,
      edge_id: options.edgeId,
      batch_id: `replay-${runHash}-batch-${String(batchNumber).padStart(4, "0")}`,
      sent_at: new Date(start.getTime() + Math.max(0, offset) * 1000).toISOString(),
      events: events.slice(offset, offset + 100),
    }));
  }
  return batches;
}
