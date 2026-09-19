import { z } from "zod";
import { contentHash, edgeRecordSchema, type EdgeRecord } from "./wire.ts";
import type { RawExporterEvent } from "./exporter-wire.ts";

const id = z.string().min(1).max(120);
const finite = z.number().finite();
const site = z.string().regex(/^(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-6])$/);
const siteMap = <T extends z.ZodTypeAny>(value: T) => z.record(site, value);
const request = z.object({
  request_id: id, stage: z.number().int().min(1).max(6),
  device_ids: siteMap(id), prediction_ids: siteMap(id), predictions: siteMap(finite),
  coverage: siteMap(finite.min(0).max(1)), latency_ms: finite.nonnegative().optional(),
});
const actual = z.object({
  request_id: id, prediction_id: id.optional(), device_id: id,
  site: z.union([site, z.number().int().min(1).max(256)]),
  stage: z.number().int().min(1).max(6), actual: finite.nullable(),
  absolute_error: finite.nonnegative().nullable().optional(),
});
const responseStatus = (value: unknown): EdgeRecord["response_status"] =>
  value === "response_queued" ? "response_queued" : value === "insufficient_current_data" ? "insufficient_data" : "unknown";
const perSiteId = async (requestId: string, siteId: number) => `site-${await contentHash([requestId, siteId])}`;

/** Source records stay intact for raw recovery/ACKs; projections share their transaction. */
export async function projectExporterEvents(rawEvents: RawExporterEvent[], sources: EdgeRecord[]): Promise<EdgeRecord[]> {
  const sourceMap = new Map(sources.map(event => [JSON.stringify([event.run_id, event.tester_id, event.event_id]), event]));
  const projected: EdgeRecord[] = [];
  for (const raw of rawEvents) {
    if (!["prediction_request", "prediction_actual"].includes(raw.event_type)) continue;
    const source = sourceMap.get(JSON.stringify([raw.run_id, raw.tester_id, raw.event_id]));
    if (!source) throw new Error("Exporter projection has no source record");
    const payload = raw.payload;
    const common = {
      run_id: source.run_id, tester_id: source.tester_id, source_mode: source.source_mode,
      timestamp: source.timestamp, sequence: source.sequence, lot_id: source.lot_id, wafer_id: source.wafer_id,
      source_event_id: raw.event_id, data_quality: "partial" as const,
      ...(typeof payload.model_sha256 === "string" ? { model_version: payload.model_sha256 } : {}),
      // Missing runtime unit/attempt metadata remains unknown, including coverage=1.
      unit: payload.unit === undefined ? null : payload.unit,
      ...(payload.attempt != null ? { attempt: payload.attempt } : {}),
    };
    if (raw.event_type === "prediction_request") {
      const parsed = request.parse(payload);
      for (const key of [...Object.keys(parsed.predictions), ...Object.keys(parsed.prediction_ids), ...Object.keys(parsed.coverage)]) {
        if (!(key in parsed.device_ids)) throw new z.ZodError([{ code: "custom", path: ["device_ids", key], message: "site data requires device identity" }]);
      }
      for (const key of Object.keys(parsed.predictions)) {
        if (!parsed.prediction_ids[key]) throw new z.ZodError([{ code: "custom", path: ["prediction_ids", key], message: "prediction requires original per-site identity" }]);
      }
      for (const [key, deviceId] of Object.entries(parsed.device_ids)) {
        const siteId = Number(key);
        projected.push(edgeRecordSchema.parse({
          ...common, event_id: `projection-${await contentHash([raw.run_id, raw.tester_id, raw.event_id, "prediction", siteId])}`,
          type: "prediction", device_id: deviceId, site_id: siteId, stage: parsed.stage,
          request_id: parsed.prediction_ids[key] ?? await perSiteId(parsed.request_id, siteId),
          original_request_id: parsed.request_id, prediction: parsed.predictions[key] ?? null,
          coverage: parsed.coverage[key], latency_ms: parsed.latency_ms, response_status: responseStatus(payload.status),
        }));
      }
    } else {
      const parsed = actual.parse(payload);
      // A missing sensor actual is retained in the source/raw record, never converted to zero.
      if (parsed.actual === null) continue;
      projected.push(edgeRecordSchema.parse({
        ...common, event_id: `projection-${await contentHash([raw.run_id, raw.tester_id, raw.event_id, "prediction_actual", Number(parsed.site)])}`,
        type: "prediction_actual", device_id: parsed.device_id, site_id: Number(parsed.site), stage: parsed.stage,
        request_id: parsed.prediction_id ?? await perSiteId(parsed.request_id, Number(parsed.site)),
        original_request_id: parsed.request_id, actual: parsed.actual,
        absolute_error: parsed.absolute_error ?? undefined,
        response_status: responseStatus(payload.prediction_status),
      }));
    }
  }
  return projected;
}

/** Join only a unique prediction and a unique actual, independent of delivery order. */
export function joinPredictionActuals(events: EdgeRecord[]): EdgeRecord[] {
  const predictions = events.filter(event => event.type === "prediction");
  const actuals = events.filter(event => event.type === "prediction_actual");
  const matches = (prediction: EdgeRecord, observed: EdgeRecord) =>
    prediction.run_id === observed.run_id && prediction.tester_id === observed.tester_id && prediction.request_id === observed.request_id
    && (["device_id", "site_id", "stage", "lot_id", "wafer_id", "attempt", "original_request_id"] as const)
      .every(key => observed[key] === undefined || prediction[key] === observed[key]);
  const key = (event: EdgeRecord) => JSON.stringify([event.run_id, event.tester_id, event.request_id]);
  const byRequest = new Map<string, EdgeRecord[]>();
  for (const prediction of predictions) {
    const group = byRequest.get(key(prediction)) ?? [];
    group.push(prediction); byRequest.set(key(prediction), group);
  }
  const candidates = new Map<EdgeRecord, EdgeRecord[]>();
  const byPrediction = new Map<EdgeRecord, EdgeRecord[]>();
  for (const observed of actuals) {
    const group = (byRequest.get(key(observed)) ?? []).filter(prediction => matches(prediction, observed));
    candidates.set(observed, group);
    for (const prediction of group) {
      const observations = byPrediction.get(prediction) ?? [];
      observations.push(observed); byPrediction.set(prediction, observations);
    }
  }
  return events.map(event => {
    if (event.type !== "prediction") return event;
    const observations = byPrediction.get(event) ?? [];
    if (observations.length !== 1 || candidates.get(observations[0])?.length !== 1) return event;
    const observed = observations[0];
    return { ...event, actual: observed.actual,
      ...(event.prediction != null ? { absolute_error: Math.abs(event.prediction - observed.actual!) } : {}),
    };
  });
}
