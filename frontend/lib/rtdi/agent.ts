import { instructions } from "./assistant.ts";
import { toolDefinitions, toolNames, type ToolExecutor, type ToolName, type ToolTrace } from "./tool-contract.ts";

type ResponsesOutput = { type: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type: string; text?: string }> };
type ResponsesResult = { status?: string; output?: ResponsesOutput[] };

export type InvestigationResult = {
  answer: string;
  evidence_ids: string[];
  tool_trace: ToolTrace[];
  status: "complete" | "incomplete";
};

export async function runToolInvestigation(input: {
  apiKey: string;
  model: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  scope: { run_id: string; tester_id?: string | null; incident_id?: string | null };
  executeTool: ToolExecutor;
  fetcher?: typeof fetch;
  maxToolCalls?: number;
  deadlineMs?: number;
}): Promise<InvestigationResult> {
  const fetcher = input.fetcher ?? fetch;
  const maxToolCalls = input.maxToolCalls ?? 6;
  const deadlineAt = Date.now() + (input.deadlineMs ?? 20_000);
  const toolTrace: ToolTrace[] = [];
  const evidenceIds = new Set<string>();
  const conversation: unknown[] = [
    ...input.history,
    { role: "user", content: `調查範圍：${JSON.stringify(input.scope)}\n問題：${input.question}` },
  ];
  let toolCalls = 0;

  while (true) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < 500) throw new Error("investigation deadline exceeded");
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(Math.min(30_000, remainingMs)),
      body: JSON.stringify({
        model: input.model,
        store: false,
        instructions: `${instructions}\n每次調查第一步必須先呼叫工具確認 run 範圍。異常數值結論必須先取得 incident evidence；工具失敗或證據不足時不得補猜。工具調查回覆只引用工具已驗證的 evidence_id；沒有 evidence 時不要自行加入括號 ID。`,
        input: conversation,
        tools: toolDefinitions,
        tool_choice: toolCalls === 0 ? "required" : "auto",
        parallel_tool_calls: false,
        max_output_tokens: 2200,
      }),
    });
    if (!response.ok) {
      const error = new Error(`OpenAI upstream returned ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const result = await response.json() as ResponsesResult;
    const outputs = result.output ?? [];
    const calls = outputs.filter((item): item is ResponsesOutput & { name: ToolName; arguments: string; call_id: string } =>
      item.type === "function_call" && toolNames.includes(item.name as ToolName) && typeof item.arguments === "string" && typeof item.call_id === "string");
    if (!calls.length) {
      const answer = outputs.filter(item => item.type === "message").flatMap(item => item.content ?? [])
        .filter(content => content.type === "output_text").map(content => content.text ?? "").join("\n").trim();
      if (!answer || result.status === "incomplete") throw new Error("model did not produce a complete answer");
      const citedIds = [...answer.matchAll(/\[([A-Za-z0-9_.:-]{1,120})\]/g)].map(match => match[1]);
      const unknownIds = citedIds.filter(id => !evidenceIds.has(id));
      if (unknownIds.length) throw new Error("model cited evidence outside the verified tool results");
      if (evidenceIds.size && !citedIds.some(id => evidenceIds.has(id))) throw new Error("model answer omitted verified evidence citations");
      return { answer, evidence_ids: [...evidenceIds], tool_trace: toolTrace, status: "complete" };
    }
    if (toolCalls + calls.length > maxToolCalls) throw new Error("investigation tool-call limit exceeded");
    conversation.push(...outputs);
    for (const call of calls) {
      toolCalls += 1;
      let argumentsValue: unknown;
      try { argumentsValue = JSON.parse(call.arguments); }
      catch { throw new Error(`invalid arguments for ${call.name}`); }
      try {
        const executed = await input.executeTool(call.name, argumentsValue);
        executed.evidence_ids.forEach(id => evidenceIds.add(id));
        toolTrace.push({ name: call.name, arguments: argumentsValue, evidence_ids: executed.evidence_ids, ok: true });
        conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(executed.output) });
      } catch (error) {
        toolTrace.push({ name: call.name, arguments: argumentsValue, evidence_ids: [], ok: false });
        conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: error instanceof Error ? error.message : "tool failed" }) });
      }
    }
  }
}
