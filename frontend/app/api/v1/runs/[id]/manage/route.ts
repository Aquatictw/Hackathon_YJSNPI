import { env } from "cloudflare:workers";
import { z } from "zod";
import { HttpInputError, json, readJsonBody, sameOrigin } from "@/lib/rtdi/http";
import { manageRun, RunManagementError, StorageUnavailableError } from "@/lib/rtdi/repository";

const idSchema = z.string().min(1).max(120).refine(value => value.trim() === value && value.length > 0);
const inputSchema = z.object({ tester_id: idSchema, action: z.enum(["archive", "delete"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const bindings = env as unknown as Record<string, string | undefined>;
  const publicOrigin = bindings.PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN || bindings.APP_ORIGIN || process.env.APP_ORIGIN || "";
  if (!request.headers.get("origin") || !sameOrigin(request, publicOrigin)) {
    return json({ error: "Run management requires an explicit same-origin request.", code: "origin_rejected" }, 403);
  }
  try {
    const id = idSchema.parse((await context.params).id);
    const input = inputSchema.parse(await readJsonBody(request, 4096));
    await manageRun(id, input.tester_id, input.action);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "Invalid run management request.", issues: error.issues }, 422);
    if (error instanceof RunManagementError) return json({ error: error.message, code: error.code }, error.code === "run_not_found" ? 404 : 409);
    if (error instanceof StorageUnavailableError) return json({ error: "Storage unavailable.", code: "storage_unavailable" }, 503);
    return json({ error: "Run management is temporarily unavailable." }, 503);
  }
}
