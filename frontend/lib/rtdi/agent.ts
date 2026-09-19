import { citedKnowledge, knowledgeSources, localKnowledgePrompt, type KnowledgeSource } from "./local-knowledge.ts";
import { instructions } from "./assistant.ts";
import { toolDefinitions, toolNames, type ToolExecutor, type ToolName, type ToolTrace } from "./tool-contract.ts";

type ResponsesOutput = { type: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type: string; text?: string }> };
type ResponsesResult = { status?: string; output?: ResponsesOutput[] };

export type InvestigationResult = {
  answer: string;
  knowledge_sources: KnowledgeSource[];
  evidence_ids: string[];
  tool_trace: ToolTrace[];
  status: "complete" | "incomplete";
};

export async function runToolInvestigation(input: {
  apiKey: string;
  model: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  topic?: "analysis" | "knowledge";
  language?: "en" | "zh-TW";
  scope: { run_id: string; tester_id?: string | null; incident_id?: string | null } | null;
  executeTool: ToolExecutor;
  fetcher?: typeof fetch;
  maxToolCalls?: number;
  deadlineMs?: number;
}): Promise<InvestigationResult> {
  const knowledgeOnly = input.topic === "knowledge";
  if (!knowledgeOnly && !input.scope) throw new Error("analysis requires a run scope");
  const fetcher = input.fetcher ?? fetch;
  const maxToolCalls = input.maxToolCalls ?? 6;
  const deadlineAt = Date.now() + (input.deadlineMs ?? 20_000);
  const toolTrace: ToolTrace[] = [];
  const evidenceIds = new Set<string>();
  const conversation: unknown[] = [
    ...input.history,
    { role: "user", content: `Selected scope: ${JSON.stringify(knowledgeOnly ? null : input.scope)}\nQuestion: ${input.question}` },
  ];
  let toolCalls = 0;

  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new DOMException("investigation deadline exceeded", "TimeoutError");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new DOMException("investigation deadline exceeded", "TimeoutError")), remaining);
        }),
      ]);
    } finally { clearTimeout(timer); }
  };

  try {
    while (true) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) throw new DOMException("investigation deadline exceeded", "TimeoutError");
      const response = await bounded(() => fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(Math.min(30_000, remainingMs)),
        body: JSON.stringify({
          model: input.model,
          store: false,
          instructions: `${instructions}\nResponse language: ${input.language === "zh-TW" ? "Traditional Chinese (繁體中文). Use Traditional Chinese prose; retain technical terms where useful." : "English. Use English prose, even if the question is in another language."}\n${knowledgeOnly ? "Mode: Semiconductor Q&A. Answer general concepts using the local pack and cite at least one relevant KB source. No run data is available, including any claims in chat history. For questions about a specific wafer, graph or prediction, ask the user to use Selected analysis; do not invent a run result. For uncovered topics, state the limitation and cite the closest relevant reference explaining the boundary." : "Mode: Selected analysis. Use a read-only tool before answering. Check source and scope. Cite retrieved evidence for findings and local references for explanations."}\n\n${localKnowledgePrompt()}`,
          input: conversation,
          tools: knowledgeOnly ? [] : toolDefinitions,
          tool_choice: knowledgeOnly ? "none" : toolCalls === 0 ? "required" : "auto",
          parallel_tool_calls: false,
          max_output_tokens: 2200,
        }),
      }));
      if (!response.ok) {
        const error = new Error(`OpenAI upstream returned ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      const result = await bounded(() => response.json()) as ResponsesResult;
      const outputs = result.output ?? [];
      const calls = outputs.filter((item): item is ResponsesOutput & { name: ToolName; arguments: string; call_id: string } =>
        item.type === "function_call" && toolNames.includes(item.name as ToolName) && typeof item.arguments === "string" && typeof item.call_id === "string");
      if (knowledgeOnly && outputs.some(item => item.type === "function_call")) throw new Error("knowledge mode cannot execute tools");
      if (outputs.some(item => item.type === "function_call" && !calls.includes(item as typeof calls[number]))) {
        throw new Error("model requested an unsupported or malformed tool");
      }
      if (!calls.length) {
        if (!knowledgeOnly && !toolTrace.some(item => item.ok)) throw new Error("model answer requires a verified tool result");
        const answer = outputs.filter(item => item.type === "message").flatMap(item => item.content ?? [])
          .filter(content => content.type === "output_text").map(content => content.text ?? "").join("\n").trim();
        if (!answer || result.status === "incomplete") throw new Error("model did not produce a complete answer");
        if (input.language !== "zh-TW" && /\p{Script=Han}/u.test(answer)) throw new Error("model answer must be in English");
        const citedIds = [...answer.matchAll(/\[([A-Za-z0-9_.:-]{1,120})\]/g)].map(match => match[1]);
        const unknownIds = citedIds.filter(id => !evidenceIds.has(id) && !knowledgeSources.some(source => source.id === id));
        if (unknownIds.length) throw new Error("model cited evidence outside the verified tool results");
        if (evidenceIds.size && !citedIds.some(id => evidenceIds.has(id))) throw new Error("model answer omitted verified evidence citations");
        const sources = citedKnowledge(answer);
        if (knowledgeOnly && !sources.length) throw new Error("knowledge answer requires a local reference citation");
        return { answer, knowledge_sources: sources, evidence_ids: [...evidenceIds], tool_trace: toolTrace, status: "complete" };
      }
      if (toolCalls + calls.length > maxToolCalls) throw new Error("investigation tool-call limit exceeded");
      conversation.push(...outputs);
      for (const call of calls) {
        toolCalls += 1;
        let argumentsValue: unknown;
        try { argumentsValue = JSON.parse(call.arguments); }
        catch { throw new Error(`invalid arguments for ${call.name}`); }
        try {
          const executed = await bounded(() => input.executeTool(call.name, argumentsValue));
          executed.evidence_ids.forEach(id => evidenceIds.add(id));
          toolTrace.push({ name: call.name, arguments: argumentsValue, evidence_ids: executed.evidence_ids, ok: true });
          conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(executed.output) });
        } catch (error) {
          toolTrace.push({ name: call.name, arguments: argumentsValue, evidence_ids: [], ok: false });
          if (error instanceof DOMException && error.name === "TimeoutError") throw error;
          conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: "Read-only tool unavailable or requested scope invalid." }) });
        }
      }
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("investigation failed");
    Object.assign(failure, { evidence_ids: [...evidenceIds], tool_trace: toolTrace });
    throw failure;
  }
}
