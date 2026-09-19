import { z } from "zod";
import { validatedView } from "./contracts";
import { demoAnswer } from "./assistant";
import { runToolInvestigation, type InvestigationResult } from "./agent";
import { contextToolExecutor, persistentToolExecutor } from "./investigation-tools";
import { AmbiguousScopeError, finishInvestigation, getRunSnapshot, startInvestigation, StorageUnavailableError } from "./repository";
import { HttpInputError, json, readJsonBody, sameOrigin } from "./http";
import type { ToolTrace } from "./tool-contract";
import { serverConfig } from "./server-config";

const id = z.string().min(1).max(120);
const requestSchema = z.object({
  mode: z.enum(["demo", "openai"]),
  language: z.enum(["en", "zh-TW"]).default("en"),
  topic: z.enum(["analysis", "knowledge"]).default("analysis"),
  question: z.string().trim().min(1).max(2000),
  context: z.unknown().optional(),
  run_id: id.optional(),
  tester_id: id.optional(),
  incident_id: id.optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(5000) }).strict()).max(12).default([]),
}).strict();

let recent: number[] = [];

export async function handleChat(request: Request, forcedRunId?: string): Promise<Response> {
  const config = serverConfig();
  if (!sameOrigin(request, config.publicOrigin)) return json({ error: "Please submit requests from this website." }, 403);
  let body: z.infer<typeof requestSchema>;
  try { body = requestSchema.parse(await readJsonBody(request, 65_536)); }
  catch (error) {
    if (error instanceof HttpInputError) return json({ error: "The request body is invalid or too large." }, error.status);
    return json({ error: "The request is invalid or too large. Check your input." }, 400);
  }
  if (body.topic === "knowledge" && (forcedRunId || body.run_id || body.tester_id || body.incident_id || body.context !== undefined || body.mode !== "openai")) return json({ error: "Semiconductor Q&A does not accept run context. Use Selected analysis for run-specific questions." }, 400);
  if (body.topic !== "knowledge" && !forcedRunId && body.context === undefined && body.run_id === undefined) return json({ error: "Select a run for analysis, or use Semiconductor Q&A." }, 400);
  if (forcedRunId && body.run_id && body.run_id !== forcedRunId) return json({ error: "The run ID does not match the URL scope." }, 409);

  const queryTester = forcedRunId ? new URL(request.url).searchParams.get("tester_id") : null;
  if (queryTester !== null && !id.safeParse(queryTester).success) return json({ error: "The tester ID is invalid." }, 400);
  if (queryTester && body.tester_id && queryTester !== body.tester_id) return json({ error: "tester_id does not match the URL scope." }, 409);

  const view = body.context === undefined ? null : (() => {
    try { return validatedView(body.context); }
    catch { return null; }
  })();
  if (body.context !== undefined && !view) return json({ error: "The event context is invalid." }, 400);
  if (body.mode === "demo") {
    if (!view) return json({ error: "Rule-based demonstration requires the current event context." }, 400);
    return json({ mode: "demo", answer: demoAnswer(view, body.question), model: null, evidence_ids: view.evidence.map(item => item.evidence_id), investigation_id: null });
  }

  const { key, model } = config;
  if (!key) return json({ error: "The model service is not configured. The rule-based sandbox remains available.", code: "missing_api_key" }, 503);
  recent = recent.filter(time => Date.now() - time < 60_000);
  if (recent.length >= 6) return json({ error: "Please try again shortly. The service allows up to 6 AI requests per minute.", code: "rate_limited" }, 429);
  recent.push(Date.now());

  const runId = forcedRunId ?? body.run_id ?? view?.event.run_id;
  if (body.topic !== "knowledge" && !runId) return json({ error: "A run ID is required for selected analysis." }, 400);
  let testerId = queryTester ?? body.tester_id ?? view?.event.tester_id ?? null;
  const persisted = Boolean(forcedRunId || body.run_id);
  let investigationId: string | null = null;
  let completed: InvestigationResult | undefined;
  try {
    if (persisted) {
      const snapshot = await getRunSnapshot(runId!, testerId);
      if (!snapshot) return json({ error: "The selected run was not found.", code: "run_not_found" }, 404);
      testerId = snapshot.run.tester_id;
      if (body.incident_id && !snapshot.incidents.some(item => item.incident_id === body.incident_id)) {
        return json({ error: "The selected incident was not found in this run.", code: "incident_not_found" }, 404);
      }
      investigationId = await startInvestigation({ run_id: runId!, tester_id: snapshot.run.tester_id, incident_id: body.incident_id, question: body.question, model });
    }
    const result = await runToolInvestigation({
      topic: body.topic,
      language: body.language,
      apiKey: key,
      model,
      question: body.question,
      history: body.history,
      scope: runId ? { run_id: runId, tester_id: testerId, incident_id: body.incident_id } : null,
      executeTool: body.topic === "knowledge" ? async () => { throw new Error("Run data is unavailable in knowledge mode."); } : persisted ? persistentToolExecutor({ run_id: runId!, tester_id: testerId }) : contextToolExecutor(view!),
    });
    completed = result;
    if (investigationId) await finishInvestigation(investigationId, { status: result.status, answer: result.answer, evidence_ids: result.evidence_ids, tool_trace: result.tool_trace });
    return json({ mode: "openai", answer: result.answer, knowledge_sources: result.knowledge_sources, model, evidence_ids: result.evidence_ids, investigation_id: investigationId, tool_count: result.tool_trace.length });
  } catch (error) {
    if (investigationId) {
      const failure = error as { evidence_ids?: string[]; tool_trace?: ToolTrace[] } | null;
      try { await finishInvestigation(investigationId, {
        status: "failed", error: error instanceof DOMException && error.name === "TimeoutError" ? "investigation deadline exceeded" : "investigation failed",
        evidence_ids: failure?.evidence_ids ?? completed?.evidence_ids ?? [], tool_trace: failure?.tool_trace ?? completed?.tool_trace ?? [],
      }); }
      catch { /* Keep the original failure as the user-facing error. */ }
    }
    if (error instanceof StorageUnavailableError) return json({ error: "The analysis database is unavailable.", code: "storage_unavailable" }, 503);
    if (error instanceof AmbiguousScopeError) return json({ error: "Select a tester to disambiguate this run.", code: "ambiguous_scope" }, 409);
    const status = (error as (Error & { status?: number }) | null)?.status;
    if (status === 401) return json({ error: "Model authentication failed. Check the server configuration.", code: "upstream_error" }, 502);
    if (status === 429) return json({ error: "The model service reached its quota or rate limit. Try again later.", code: "upstream_error" }, 502);
    if (status === 403 || status === 404) return json({ error: "The configured model is unavailable. Check the model name and access permissions.", code: "upstream_error" }, 502);
    if (error instanceof DOMException && error.name === "TimeoutError") return json({ error: "The assistant request timed out. Edge predictions are unaffected.", code: "connection_error" }, 504);
    return json({ error: "The assistant could not complete a verified answer. Try again. Edge predictions and alerts remain unaffected.", code: "investigation_failed" }, 502);
  }
}
