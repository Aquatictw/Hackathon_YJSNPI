import { z } from "zod";
import { bearerMatches, json } from "@/lib/rtdi/http";
import { getPendingCommands, StorageUnavailableError } from "@/lib/rtdi/repository";
import { serverConfig } from "@/lib/rtdi/server-config";

const querySchema = z.object({
  tester_id: z.string().min(1).max(120),
  run_id: z.string().min(1).max(120).nullable(),
});

export async function GET(request: Request) {
  const { commandToken } = serverConfig();
  if (!commandToken) return json({ error: "COMMAND_TOKEN 尚未設定，command 通道保持關閉。", code: "commands_not_configured" }, 503);
  if (!bearerMatches(request, commandToken)) return json({ error: "Edge command client 未通過驗證。", code: "unauthorized" }, 401);
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({ tester_id: url.searchParams.get("tester_id"), run_id: url.searchParams.get("run_id") });
    return json({ commands: await getPendingCommands(query.tester_id, query.run_id) });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "tester_id 必填，run_id 若提供則不可為空。", issues: error.issues }, 422);
    if (error instanceof StorageUnavailableError) return json({ error: "後端資料庫尚未啟用。" }, 503);
    return json({ error: "暫時無法讀取 command。" }, 503);
  }
}
