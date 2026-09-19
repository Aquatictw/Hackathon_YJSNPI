import { z } from "zod";
import { measurementQuerySchema } from "@/lib/rtdi/backend-measurements";
import { json } from "@/lib/rtdi/http";
import { getDeviceMeasurements, StorageUnavailableError } from "@/lib/rtdi/repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const query = measurementQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const page = await getDeviceMeasurements(id, query.tester_id, query.event_id, query.offset, query.limit);
    return page ? json(page) : json({ error: "Device bundle not found in this run/tester scope." }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "Invalid measurement query.", issues: error.issues }, 422);
    if (error instanceof StorageUnavailableError) return json({ error: "Storage unavailable." }, 503);
    return json({ error: "Unable to read device measurements." }, 503);
  }
}
