import { z } from "zod";
import { edgeBatchSchema, type EdgeBatch, type EdgeRecord } from "./wire.ts";

const id = z.string().min(1).max(120);
const finite = z.number().finite();

export const exporterEventSchema = z.object({
  schema_version: z.union([z.literal("1"), z.literal(1)]),
  event_id: id,
  sequence: z.number().int().nonnegative(),
  mode: z.enum(["live", "replay", "simulation"]),
  event_type: z.string().min(1).max(120),
  timestamp: finite.min(0).max(8_640_000_000),
  tester_id: id,
  run_id: id,
  lot_id: z.union([id, z.null()]).optional(),
  wafer_id: z.union([id, z.number().int().nonnegative(), z.null()]).optional(),
}).passthrough();

export const exporterBatchSchema = z.object({
  schema_version: z.union([z.literal("1"), z.literal(1)]),
  edge_id: id,
  batch_id: id,
  events: z.array(exporterEventSchema).min(1).max(100),
}).strict();

const alertSchema = z.object({
  kind: z.string().min(1).max(80),
  message: z.string().min(1).max(2000),
  test: z.string().min(1).max(240),
  site: z.union([z.string(), z.number()]),
  completed_devices: z.number().int().nonnegative(),
  observed: finite,
  reference: finite,
  score: finite,
  series: z.array(finite).max(320),
  site_series: z.record(z.string(), z.array(finite).max(320)),
  suggestion: z.string().max(1000),
}).passthrough();

export type ExporterBatch = z.infer<typeof exporterBatchSchema>;
export type RawExporterEvent = {
  event_id: string;
  run_id: string;
  tester_id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

const optionalId = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
const optionalSite = (value: unknown): number | undefined => {
  const site = Number(value);
  return Number.isInteger(site) && site >= 1 && site <= 256 ? site : undefined;
};
const directionFor = (kind: string): string | undefined => {
  if (kind.endsWith("_up")) return "up";
  if (kind.endsWith("_down")) return "down";
  return undefined;
};
const responseStatus = (value: unknown): EdgeRecord["response_status"] => {
  if (value === "response_queued") return "response_queued";
  if (value === "insufficient_current_data") return "insufficient_data";
  return undefined;
};

function normalizeEvent(event: z.infer<typeof exporterEventSchema>): EdgeRecord {
  const base = {
    event_id: event.event_id,
    source_mode: event.mode,
    run_id: event.run_id,
    tester_id: event.tester_id,
    ...(optionalId(event.lot_id) ? { lot_id: optionalId(event.lot_id) } : {}),
    ...(event.wafer_id != null ? { wafer_id: String(event.wafer_id) } : {}),
    timestamp: new Date(event.timestamp * 1000).toISOString(),
    sequence: event.sequence,
  } as const;
  if (event.event_type === "alert") {
    const alert = alertSchema.parse(event.alert);
    const siteId = optionalSite(alert.site);
    const siteIds = Object.keys(alert.site_series).map(Number)
      .filter(site => Number.isInteger(site) && site >= 1 && site <= 256);
    return {
      ...base,
      type: "evidence",
      ...(siteId ? { site_id: siteId } : {}),
      ...(siteIds.length ? { site_ids: siteIds } : {}),
      evidence_id: event.event_id,
      incident_id: event.event_id,
      kind: alert.kind,
      ...(directionFor(alert.kind) ? { direction: directionFor(alert.kind) } : {}),
      sample_count: alert.completed_devices,
      score: alert.score,
      baseline: alert.reference,
      current_value: alert.observed,
      affected_tests: [alert.test],
      series: alert.series,
      site_series: alert.site_series,
      suggestion: alert.suggestion,
      severity: "warning",
      message: alert.message,
      completed_devices: alert.completed_devices,
      ...(alert.kind === "low_yield" ? { yield: alert.observed } : {}),
      data_quality: "partial",
    };
  }
  const siteId = optionalSite(event.site);
  return {
    ...base,
    type: "run_summary",
    ...(optionalId(event.device_id) ? { device_id: optionalId(event.device_id) } : {}),
    ...(siteId ? { site_id: siteId } : {}),
    ...(typeof event.stage === "number" ? { stage: event.stage } : {}),
    ...(responseStatus(event.status) ? { response_status: responseStatus(event.status) } : {}),
    ...(optionalId(event.artifact_version) ? { version: optionalId(event.artifact_version) } : {}),
    message: `Edge exporter event: ${event.event_type}`,
    data_quality: event.data_quality === "complete" ? "complete" : "partial",
  };
}

export function normalizeExporterBatch(value: unknown): { batch: EdgeBatch; rawEvents: RawExporterEvent[]; identityPayload: ExporterBatch } {
  const incoming = exporterBatchSchema.parse(value);
  const events = incoming.events.map(normalizeEvent);
  return {
    batch: edgeBatchSchema.parse({ schema_version: 1, edge_id: incoming.edge_id, batch_id: incoming.batch_id, events }),
    rawEvents: incoming.events.map(event => ({
      event_id: event.event_id,
      run_id: event.run_id,
      tester_id: event.tester_id,
      event_type: event.event_type,
      payload: event,
    })),
    identityPayload: incoming,
  };
}
