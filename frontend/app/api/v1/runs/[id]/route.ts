import { json } from "@/lib/rtdi/http";
import { AmbiguousScopeError, getRunSnapshot, StorageUnavailableError } from "@/lib/rtdi/repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const testerId = new URL(request.url).searchParams.get("tester_id");
  try {
    const snapshot = await getRunSnapshot(id, testerId);
    return snapshot ? json(snapshot) : json({ error: "找不到指定 run。" }, 404);
  } catch (error) {
    if (error instanceof AmbiguousScopeError) return json({ error: error.message }, 409);
    if (error instanceof StorageUnavailableError) return json({ error: "後端資料庫尚未啟用。" }, 503);
    return json({ error: "暫時無法讀取 run。" }, 503);
  }
}
