export const toolNames = ["get_run_summary", "get_incident_evidence", "compare_sites", "get_prediction_records"] as const;
export type ToolName = typeof toolNames[number];
export type ToolTrace = { name: ToolName; arguments: unknown; evidence_ids: string[]; ok: boolean };
export type ToolExecution = { output: unknown; evidence_ids: string[] };
export type ToolExecutor = (name: ToolName, argumentsValue: unknown) => Promise<ToolExecution>;

export const toolDefinitions = [
  {
    type: "function", name: "get_run_summary", strict: true,
    description: "Read source mode, freshness, scope and event/incident counts for a run. Use this to establish the available data.",
    parameters: { type: "object", additionalProperties: false, properties: { run_id: { type: "string" }, tester_id: { type: ["string", "null"] } }, required: ["run_id", "tester_id"] },
  },
  {
    type: "function", name: "get_incident_evidence", strict: true,
    description: "Read a scoped incident and its evidence. Only returned measurements and evidence IDs support findings about this incident.",
    parameters: { type: "object", additionalProperties: false, properties: { run_id: { type: "string" }, incident_id: { type: "string" } }, required: ["run_id", "incident_id"] },
  },
  {
    type: "function", name: "compare_sites", strict: true,
    description: "Compare sites using stored evidence. Do not invent missing measurements, units or causal explanations.",
    parameters: { type: "object", additionalProperties: false, properties: { run_id: { type: "string" }, tester_id: { type: ["string", "null"] }, incident_id: { type: ["string", "null"] } }, required: ["run_id", "tester_id", "incident_id"] },
  },
  {
    type: "function", name: "get_prediction_records", strict: true,
    description: "Read up to 100 prediction/actual records for the selected run, optionally filtered by stage and site. These are source records with any repository-validated actual joins; standalone actual records still require identity checks. Cite returned event IDs, preserve source and identity, and do not join ambiguous actuals.",
    parameters: { type: "object", additionalProperties: false, properties: { run_id: { type: "string" }, tester_id: { type: ["string", "null"] }, stage: { type: ["integer", "null"], minimum: 1, maximum: 6 }, site_id: { type: ["integer", "null"] } }, required: ["run_id", "tester_id", "stage", "site_id"] },
  },
] as const;
