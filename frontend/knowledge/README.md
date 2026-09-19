# Local semiconductor reference pack

The deployable content is maintained in `../lib/rtdi/local-knowledge.ts` and is
imported into the server bundle. The UI imports the same pack to show cited
reference notes. No additional service, upload, vector database, filesystem mount,
embedding request or web search is needed. Do not add secrets to this public pack.

The pack contains original educational explanations of wafer test terminology,
yield/bins, statistics, diagnostic hypotheses and this project's analysis methods.
It was authored locally, not downloaded or independently reviewed as an industry
standard. Each note includes its provenance and limitations. Project method notes
derive from the existing local SYSTEM.md and source code. Wafer evaluation labels,
historical incident answers and live deployment claims are deliberately excluded.

## Runtime

The assistant is on `/workspace`; `/` remains the replay landing page.

- Prompts: `../lib/rtdi/assistant.ts`; mode/language rules: `../lib/rtdi/agent.ts`.
- Both chat modes receive the complete small reference pack. No extra model call
  is used to classify a question, translate it or retrieve local documents.
- Semiconductor Q&A uses `POST /api/assistant` with `mode: "openai"`,
  `topic: "knowledge"`, `language: "en"` or `"zh-TW"`, `question`, and optional
  `history`. It needs no run or D1 connection and has no run tools. General chat is
  in page memory only; it is not an investigation persisted in D1.
- Selected analysis uses the existing scoped `/api/v1/runs/{id}/chat` route with
  optional `language` (default English). A verified tool result is still mandatory.
  General references cannot substitute for run evidence.
- Answers return `knowledge_sources` separately from `evidence_ids`. The frontend
  opens local notes inline and retains analysis note IDs with the conversation.
- Citation IDs are validated. English output containing Han characters is rejected
  without an automatic retry. Traditional Chinese is requested through the prompt;
  technical identifiers and citations remain unchanged. These guards do not prove
  semantic correctness or guarantee that a model follows every instruction.
- Model generation still requires network access to the configured model provider.
  No browsing or website-fetching tools are exposed. Existing deadline and call
  limits remain in effect. The sandbox's fixed-rule demonstration is separate.

## Maintenance and verification

Edit the typed reference entries, retain stable citation IDs, update provenance and
bump KNOWLEDGE_VERSION. Rebuild/redeploy for changes to take effect. Keep current-run
facts in database tools, not in reference notes. Review scientific changes with an
engineer before presenting them as validated domain guidance.

From frontend/, use Node >=22.18 and run `npm test`, `npx tsc --noEmit` and
`npm run build`. Tests mock model responses and use local SQLite, so they do not
consume paid model requests. Real model quality and provider access require a
separate manual check; automated checks must not be reported as model validation.
