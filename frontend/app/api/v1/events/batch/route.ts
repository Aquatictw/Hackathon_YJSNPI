import { z } from "zod";
import { normalizeExporterBatch } from "@/lib/rtdi/exporter-wire";
import { bearerMatches, HttpInputError, json, readJsonBody } from "@/lib/rtdi/http";
import { IdentityConflictError, ingestEdgeBatch, StorageUnavailableError } from "@/lib/rtdi/repository";
import { serverConfig } from "@/lib/rtdi/server-config";
import { edgeBatchSchema } from "@/lib/rtdi/wire";

export async function POST(request: Request) {
  const { ingestToken } = serverConfig();
  if (!ingestToken) return json({ error: "INGEST_TOKEN 尚未設定，事件入口保持關閉。", code: "ingest_not_configured" }, 503);
  if (!bearerMatches(request, ingestToken)) return json({ error: "事件來源未通過驗證。", code: "unauthorized" }, 401);
  try {
    const body = await readJsonBody(request, { maxCompressedBytes: 4_194_304, maxDecompressedBytes: 8_388_608, allowGzip: true });
    const formal = edgeBatchSchema.safeParse(body);
    if (formal.success) {
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 262_144) throw new HttpInputError(413, "正式 Edge v1 批次不可超過 256 KiB。");
      return json({ ...(await ingestEdgeBatch(formal.data)), format: "edge_v1" });
    }
    const exporter = normalizeExporterBatch(body);
    return json({ ...(await ingestEdgeBatch(exporter.batch, { identityPayload: exporter.identityPayload, rawEvents: exporter.rawEvents })), format: "grp6_exporter_v1" });
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "事件批次不符合 Edge v1 或 grp6 exporter 格式。", issues: error.issues }, 422);
    if (error instanceof IdentityConflictError) return json({ error: error.message, conflicting_ids: error.ids }, 409);
    if (error instanceof StorageUnavailableError) return json({ error: "後端資料庫尚未啟用。", code: "storage_unavailable" }, 503);
    return json({ error: "事件批次暫時無法保存。", code: "storage_error" }, 503);
  }
}
