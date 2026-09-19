import { z } from "zod";

export const measurementQuerySchema = z.object({
  tester_id: z.string().min(1).max(120), event_id: z.string().min(1).max(120),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

/** Values/flags/scaling and unknown metadata are returned exactly as stored. */
export function measurementPage(payload: Record<string, unknown>, offset: number, limit: number) {
  const measurements = z.array(z.unknown()).max(100_000).parse(payload.measurements);
  const metadata: Record<string, unknown> = {};
  for (const key of ["event_id", "run_id", "tester_id", "lot_id", "wafer_id", "device_id", "site", "head", "raw_head_site",
    "part_id", "attempt", "attempt_status", "expected_count", "received_count", "missing_count", "data_quality", "timestamp", "mode"]) {
    if (key in payload) metadata[key] = payload[key];
  }
  const page: unknown[] = [];
  let bytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
  if (bytes > 250_000) throw new Error("Measurement metadata exceeds response limit");
  for (const value of measurements.slice(offset, offset + Math.min(limit, 100))) {
    const itemBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength + 1;
    if (bytes + itemBytes > 250_000) {
      if (!page.length) throw new Error("Single measurement exceeds response limit");
      break;
    }
    page.push(value); bytes += itemBytes;
  }
  const next = offset + page.length;
  return { metadata, measurements: page, total: measurements.length, offset, next_offset: next < measurements.length ? next : null };
}
