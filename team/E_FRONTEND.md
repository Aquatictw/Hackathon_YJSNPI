# E — evidence display and command-state alignment

Read [SYSTEM.md](../SYSTEM.md). Preserve the working persisted snapshot/SSE/chat homepage and separate /replay and /sandbox. Implement remaining display/adapter gaps; do not recreate a backend.

## Write allowlist

All paths below are relative to frontend/; exclusions override directory patterns:

- UI route files under app/: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, and styles `*.css`; components/** and hooks/**. All app/api/** and app/chatgpt-auth.ts are excluded.
- `lib/rtdi/contracts.ts`, `edge-adapter.ts`, `dashboard.ts`, `replay.ts`, `replay-adapter.ts`, `fixtures.ts`, `assistant.ts`, `lib/utils.ts`; new UI helpers only as `lib/rtdi/ui-*.ts`.
- `contracts/schemas.json` (internal UI schema).
- `tests/dashboard.test.mjs`, `tests/contracts.test.mjs`, `tests/replay.test.mjs`, `tests/ui-*.test.mjs`; keep new fixtures inline/in these allowed files.

Additional repository-root allowlist: `workstreams/frontend/NOTES.md` only. Maintain [your notes](../workstreams/frontend/NOTES.md) using SYSTEM's notes rules; this does not grant ownership of other files in that directory.
Backend files/wire schema, db/drizzle, all API routes, manifests/lockfiles/scripts/configs/examples/public snapshots/vendor/licenses, core/results and team briefs stay read-only. Request A-owned changes through handoff. No blanket ownership of frontend/app or lib/rtdi.
Use local branch `teammate-e-frontend` in your own checkout/worktree from A's exact current-round handoff SHA. Publish only to remote `main` using SYSTEM's minimal synchronization protocol and [teammate prompt](../prompts/TEAMMATE.md). Never publish a remote role branch. This assignment records the completed first round; start a new round only after A supplies its updated assignment, round ID and base SHA.

## Execute

1. Align command labels/UI validation/schema with actual received/queued_to_tester states, including rejected. Replace obsolete edge_received/edge_executed semantics without presenting queueing as machine execution or confirmed delivery.
2. Preserve available series/threshold/coverage/receipt fields in UI adapters. Consume D's per-site prediction/actual projection when provided; keep missing data explicit until then. Do not synthesize live predictions from replay or calculate detector decisions in UI.
3. Preserve scoped snapshot/SSE resume/reconnect behavior, missing-run clearing, real persisted chat citations and source/freshness labels. Keep unknown units, device-order chart axes and historic-live/replay/simulation distinctions visible.
4. Add behavior checks for changed adapters/states and multi-site joins. Deliver exact commands/results, base/branch SHA, changed paths and any pending D fields/A-owned fixture updates.

## Acceptance

- All current backend command states render truthfully; receipt is never inferred from HTTP ACK/queueing/AI text. Existing snapshot/SSE/chat and replay missing-data behavior remain intact.
- Same-ID conflicts/cross-scope records are rejected; available evidence survives conversion. Empty prediction panels remain valid when source data contains no predictions.
- Run `npm test`, `npx tsc --noEmit`, `npm run build` from frontend; review responsive layout/keyboard focus/reduced motion when UI changes. Clearly separate fresh checks from inherited acceptance.

Shared freeze: keep assistant.ts public exports instructions/demoAnswer/ChatMessage and their D-consumed behavior/signatures unchanged; agent imports instructions and chat-handler imports demoAnswer. Keep EventView/validatedView backward compatible. Route breaking changes through A; allowlists prevent overlapping edits, not semantic regressions. Check your authored commits (`git show --name-only <commit>`), staged edits and untracked paths before handoff; a cumulative base diff may include synchronized teammate work.
