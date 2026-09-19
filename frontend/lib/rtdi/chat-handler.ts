import { z } from "zod";
import { validatedView } from "./contracts";
import { demoAnswer } from "./assistant";
import { runToolInvestigation } from "./agent";
import { contextToolExecutor, persistentToolExecutor } from "./investigation-tools";
import { AmbiguousScopeError, finishInvestigation, getRunSnapshot, startInvestigation, StorageUnavailableError } from "./repository";
import { HttpInputError, json, readJsonBody, sameOrigin } from "./http";
import { serverConfig } from "./server-config";

const id = z.string().min(1).max(120);
const requestSchema = z.object({
  mode: z.enum(["demo", "openai"]),
  question: z.string().trim().min(1).max(2000),
  context: z.unknown().optional(),
  run_id: id.optional(),
  tester_id: id.optional(),
  incident_id: id.optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(5000) }).strict()).max(12).default([]),
}).strict();

let recent: number[] = [];

export async function handleChat(request: Request, forcedRunId?: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "請從此網站發送請求。" }, 403);
  let body: z.infer<typeof requestSchema>;
  try { body = requestSchema.parse(await readJsonBody(request, 65_536)); }
  catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    return json({ error: "事件格式不完整或請求過大，請檢查輸入。" }, 400);
  }
  if (!forcedRunId && body.context === undefined && body.run_id === undefined) return json({ error: "context 或 run_id 至少需要一項。" }, 400);
  if (forcedRunId && body.run_id && body.run_id !== forcedRunId) return json({ error: "run_id 與網址範圍不一致。" }, 409);

  const view = body.context === undefined ? null : (() => {
    try { return validatedView(body.context); }
    catch { return null; }
  })();
  if (body.context !== undefined && !view) return json({ error: "事件 context 格式不完整。" }, 400);
  if (body.mode === "demo") {
    if (!view) return json({ error: "示範解讀需要目前畫面事件。" }, 400);
    return json({ mode: "demo", answer: demoAnswer(view, body.question), model: null, evidence_ids: view.evidence.map(item => item.evidence_id), investigation_id: null });
  }

  const { key, model } = serverConfig();
  if (!key) return json({ error: "尚未設定伺服器端 OPENAI_API_KEY。可切換到示範解讀。", code: "missing_api_key" }, 503);
  recent = recent.filter(time => Date.now() - time < 60_000);
  if (recent.length >= 6) return json({ error: "請稍候再試，每分鐘最多 6 次 AI 請求。", code: "rate_limited" }, 429);
  recent.push(Date.now());

  const runId = forcedRunId ?? body.run_id ?? view?.event.run_id;
  if (!runId) return json({ error: "缺少 run_id。" }, 400);
  const testerId = body.tester_id ?? view?.event.tester_id ?? null;
  const persisted = Boolean(forcedRunId || body.run_id);
  let investigationId: string | null = null;
  try {
    if (persisted) {
      const snapshot = await getRunSnapshot(runId, testerId);
      if (!snapshot) return json({ error: "找不到指定 run。", code: "run_not_found" }, 404);
      investigationId = await startInvestigation({ run_id: runId, tester_id: snapshot.run.tester_id, incident_id: body.incident_id, question: body.question, model });
    }
    const result = await runToolInvestigation({
      apiKey: key,
      model,
      question: body.question,
      history: body.history,
      scope: { run_id: runId, tester_id: testerId, incident_id: body.incident_id },
      executeTool: persisted ? persistentToolExecutor({ run_id: runId, tester_id: testerId }) : contextToolExecutor(view!),
    });
    if (investigationId) await finishInvestigation(investigationId, { status: result.status, answer: result.answer, evidence_ids: result.evidence_ids, tool_trace: result.tool_trace });
    return json({ mode: "openai", answer: result.answer, model, evidence_ids: result.evidence_ids, investigation_id: investigationId, tool_count: result.tool_trace.length });
  } catch (error) {
    if (investigationId) {
      try { await finishInvestigation(investigationId, { status: "failed", error: error instanceof Error ? error.message : "investigation failed" }); }
      catch { /* Keep the original failure as the user-facing error. */ }
    }
    if (error instanceof StorageUnavailableError) return json({ error: "後端資料庫尚未啟用。", code: "storage_unavailable" }, 503);
    if (error instanceof AmbiguousScopeError) return json({ error: error.message, code: "ambiguous_scope" }, 409);
    const status = (error as Error & { status?: number }).status;
    if (status === 401) return json({ error: "OpenAI 認證失敗，請檢查伺服器 API key。", code: "upstream_error" }, 502);
    if (status === 429) return json({ error: "OpenAI 用量或速率受限，請稍後再試。", code: "upstream_error" }, 502);
    if (status === 403 || status === 404) return json({ error: "無法使用所設定的 OpenAI 模型，請檢查模型名稱與權限。", code: "upstream_error" }, 502);
    if (error instanceof DOMException && error.name === "TimeoutError") return json({ error: "AI 調查逾時；已保存失敗狀態，Edge 預測不受影響。", code: "connection_error" }, 504);
    return json({ error: "AI 調查失敗；Edge 預測與既有告警仍會繼續運作。", code: "investigation_failed" }, 502);
  }
}
