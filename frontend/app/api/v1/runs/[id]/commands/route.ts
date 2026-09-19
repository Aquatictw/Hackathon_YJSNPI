import { z } from "zod";
import { createCommandSchema } from "@/lib/rtdi/command-contract";
import { HttpInputError, json, readJsonBody, sameOrigin } from "@/lib/rtdi/http";
import { AmbiguousScopeError, createRunCommand, IdentityConflictError, InvalidCommandError, StorageUnavailableError } from "@/lib/rtdi/repository";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!request.headers.get("origin") || !sameOrigin(request)) return json({ error: "command 必須由同來源瀏覽器明確送出。", code: "origin_rejected" }, 403);
  const { id } = await context.params;
  const testerId = new URL(request.url).searchParams.get("tester_id");
  try {
    const input = createCommandSchema.parse(await readJsonBody(request, 16_384));
    const result = await createRunCommand(id, testerId, input);
    return json(result, result.status === "queued" ? 201 : 200);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "command 格式不正確。", issues: error.issues }, 422);
    if (error instanceof AmbiguousScopeError) return json({ error: error.message }, 409);
    if (error instanceof IdentityConflictError) return json({ error: error.message, conflicting_ids: error.ids }, 409);
    if (error instanceof InvalidCommandError) return json({ error: error.message, code: error.code }, error.code.endsWith("not_found") ? 404 : 409);
    if (error instanceof StorageUnavailableError) return json({ error: "後端資料庫尚未啟用。" }, 503);
    return json({ error: "暫時無法建立 command。" }, 503);
  }
}
