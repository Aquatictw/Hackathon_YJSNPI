export const toolNames = ["get_run_summary", "get_incident_evidence", "compare_sites"] as const;
export type ToolName = typeof toolNames[number];
export type ToolTrace = { name: ToolName; arguments: unknown; evidence_ids: string[]; ok: boolean };
export type ToolExecution = { output: unknown; evidence_ids: string[] };
export type ToolExecutor = (name: ToolName, argumentsValue: unknown) => Promise<ToolExecution>;

export const toolDefinitions = [
  {
    type: "function", name: "get_run_summary", strict: true,
    description: "讀取指定 run 的來源模式、資料新鮮度、事件數、預測數和異常數。先用它確認資料範圍。",
    parameters: { type: "object", additionalProperties: false, properties: { run_id: { type: "string" }, tester_id: { type: ["string", "null"] } }, required: ["run_id", "tester_id"] },
  },
  {
    type: "function", name: "get_incident_evidence", strict: true,
    description: "讀取一個 incident 的真實 evidence。回傳的數值和 evidence_id 才能用於異常結論。",
    parameters: { type: "object", additionalProperties: false, properties: { run_id: { type: "string" }, incident_id: { type: "string" } }, required: ["run_id", "incident_id"] },
  },
  {
    type: "function", name: "compare_sites", strict: true,
    description: "依已保存的 evidence 比較各 site；不自行推算未提供的測量或單位。",
    parameters: { type: "object", additionalProperties: false, properties: { run_id: { type: "string" }, tester_id: { type: ["string", "null"] }, incident_id: { type: ["string", "null"] } }, required: ["run_id", "tester_id", "incident_id"] },
  },
] as const;
