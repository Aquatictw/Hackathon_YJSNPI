import { z } from "zod";
import { commandResultSchema } from "@/lib/rtdi/command-contract";
import { bearerMatches, HttpInputError, json, readJsonBody } from "@/lib/rtdi/http";
import { IdentityConflictError, InvalidCommandError, recordCommandResult, StorageUnavailableError } from "@/lib/rtdi/repository";
import { serverConfig } from "@/lib/rtdi/server-config";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { commandToken } = serverConfig();
  if (!commandToken) return json({ error: "COMMAND_TOKEN 尚未設定，command 通道保持關閉。", code: "commands_not_configured" }, 503);
  if (!bearerMatches(request, commandToken)) return json({ error: "Edge command client 未通過驗證。", code: "unauthorized" }, 401);
  const { id } = await context.params;
  try {
    const result = commandResultSchema.parse(await readJsonBody(request, 16_384));
    return json(await recordCommandResult(id, result));
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "command result 格式不正確。", issues: error.issues }, 422);
    if (error instanceof IdentityConflictError) return json({ error: error.message, conflicting_ids: error.ids }, 409);
    if (error instanceof InvalidCommandError) return json({ error: error.message, code: error.code }, error.code === "command_not_found" ? 404 : 409);
    if (error instanceof StorageUnavailableError) return json({ error: "後端資料庫尚未啟用。" }, 503);
    return json({ error: "暫時無法記錄 command result。" }, 503);
  }
}
