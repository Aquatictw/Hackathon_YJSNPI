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
  if (!sameOrigin(request, config.publicOrigin)) return json({ error: "Send requests from this website." }, 403);
  let body: z.infer<typeof requestSchema>;
  try { body = requestSchema.parse(await readJsonBody(request, 65_536)); }
  catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    return json({ error: "Invalid or oversized investigation request. Check the input." }, 400);
  }
  if (!forcedRunId && body.context === undefined && body.run_id === undefined) return json({ error: "Provide context or run_id." }, 400);
  if (forcedRunId && body.run_id && body.run_id !== forcedRunId) return json({ error: "run_id does not match the requested route." }, 409);

  const queryTester = forcedRunId ? new URL(request.url).searchParams.get("tester_id") : null;
  if (queryTester !== null && !id.safeParse(queryTester).success) return json({ error: "Invalid tester_id." }, 400);
  if (queryTester && body.tester_id && queryTester !== body.tester_id) return json({ error: "tester_id does not match the requested route." }, 409);

  const view = body.context === undefined ? null : (() => {
    try { return validatedView(body.context); }
    catch { return null; }
  })();
  if (body.context !== undefined && !view) return json({ error: "Invalid event context." }, 400);
  if (body.mode === "demo") {
    if (!view) return json({ error: "Rule-based analysis requires the selected event." }, 400);
    return json({ mode: "demo", answer: demoAnswer(view, body.question), model: null, evidence_ids: view.evidence.map(item => item.evidence_id), investigation_id: null });
  }

  const { key, model } = config;
  if (!key) return json({ error: "The investigation service is not configured. Rule-based analysis is available in the sandbox.", code: "missing_api_key" }, 503);
  recent = recent.filter(time => Date.now() - time < 60_000);
  if (recent.length >= 6) return json({ error: "Investigation rate limit reached (6 requests per minute). Try again later.", code: "rate_limited" }, 429);
  recent.push(Date.now());

  const runId = forcedRunId ?? body.run_id ?? view?.event.run_id;
  if (!runId) return json({ error: "Missing run_id." }, 400);
  let testerId = queryTester ?? body.tester_id ?? view?.event.tester_id ?? null;
  const persisted = Boolean(forcedRunId || body.run_id);
  let investigationId: string | null = null;
  let completed: InvestigationResult | undefined;
  try {
    if (persisted) {
      const snapshot = await getRunSnapshot(runId, testerId);
      if (!snapshot) return json({ error: "The requested run was not found.", code: "run_not_found" }, 404);
      testerId = snapshot.run.tester_id;
      if (body.incident_id && !snapshot.incidents.some(item => item.incident_id === body.incident_id)) {
        return json({ error: "The incident was not found in the requested scope.", code: "incident_not_found" }, 404);
      }
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
    completed = result;
    if (investigationId) await finishInvestigation(investigationId, { status: result.status, answer: result.answer, evidence_ids: result.evidence_ids, tool_trace: result.tool_trace });
    return json({ mode: "openai", answer: result.answer, model, evidence_ids: result.evidence_ids, investigation_id: investigationId, tool_count: result.tool_trace.length });
  } catch (error) {
    if (investigationId) {
      const failure = error as { evidence_ids?: string[]; tool_trace?: ToolTrace[] } | null;
      try { await finishInvestigation(investigationId, {
        status: "failed", error: error instanceof DOMException && error.name === "TimeoutError" ? "investigation deadline exceeded" : "investigation failed",
        evidence_ids: failure?.evidence_ids ?? completed?.evidence_ids ?? [], tool_trace: failure?.tool_trace ?? completed?.tool_trace ?? [],
      }); }
      catch { /* Keep the original failure as the user-facing error. */ }
    }
    if (error instanceof StorageUnavailableError) return json({ error: "Investigation storage is unavailable.", code: "storage_unavailable" }, 503);
    if (error instanceof AmbiguousScopeError) return json({ error: error.message, code: "ambiguous_scope" }, 409);
    const status = (error as (Error & { status?: number }) | null)?.status;
    if (status === 401) return json({ error: "Model authentication failed. Check the server API key.", code: "upstream_error" }, 502);
    if (status === 429) return json({ error: "Model quota or rate limit reached. Try again later.", code: "upstream_error" }, 502);
    if (status === 403 || status === 404) return json({ error: "The configured model is unavailable. Check its name and access permissions.", code: "upstream_error" }, 502);
    if (error instanceof DOMException && error.name === "TimeoutError") return json({ error: "Investigation timed out. Edge predictions are unaffected.", code: "connection_error" }, 504);
    return json({ error: "Investigation failed. Edge predictions and existing alerts are unaffected.", code: "investigation_failed" }, 502);
  }
}
