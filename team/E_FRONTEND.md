# E — dashboard reconnect and asynchronous scope isolation

Round: **R2-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. The legacy first round is already accepted; do not repeat it.

## Write allowlist

All paths below are relative to frontend/; exclusions override directory patterns:

- UI route files under app/: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, and styles `*.css`; components/** and hooks/**. All app/api/** and app/chatgpt-auth.ts are excluded.
- `lib/rtdi/contracts.ts`, `edge-adapter.ts`, `dashboard.ts`, `replay.ts`, `replay-adapter.ts`, `fixtures.ts`, `assistant.ts`, `lib/utils.ts`; new UI helpers only as `lib/rtdi/ui-*.ts`.
- `contracts/schemas.json` (internal UI schema).
- `tests/dashboard.test.mjs`, `tests/contracts.test.mjs`, `tests/replay.test.mjs`, `tests/ui-*.test.mjs`; keep new fixtures inline/in these allowed files.

Additional repository-root allowlist: `workstreams/frontend/NOTES.md` only. Maintain [your notes](../workstreams/frontend/NOTES.md) using SYSTEM's notes rules; this does not grant ownership of other files in that directory.
Backend files/wire schema, db/drizzle, all API routes, manifests/lockfiles/scripts/configs/examples/public snapshots/vendor/licenses, core/results and team briefs stay read-only. Request A-owned changes through handoff. No blanket ownership of frontend/app or lib/rtdi.
Use local branch `teammate-e-frontend` in your own checkout/worktree from A's exact current-round handoff SHA. Publish only to remote `main` using SYSTEM's minimal synchronization protocol and [teammate prompt](../prompts/TEAMMATE.md). Never publish a remote role branch.


## Execute

Exercise the homepage lifecycle using controllable fetch/EventSource behavior: run/tester switches during pending snapshot/AI responses, disconnect/reconnect, burst SSE refreshes, failed/ambiguous lookup and unmount. Fix concrete stale-scope/ordering defects; retain last good data only for the same selected scope. If useful extract a UI lifecycle helper consumed by the real page, with observable behavior tests using deferred requests and late responses that ignore abort. Old snapshots/errors/citations/command states must not leak into a new scope. Preserve API shapes, seven command labels, units/provenance, persisted AI, source/freshness, read-only command UI, /replay and /sandbox. No backend/dependency changes. Report responsive/keyboard checks actually performed when markup changes.

## Frozen inputs and dependencies

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter reliability, integration/shared contracts and VM work. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- cd frontend; npm test
- cd frontend; npx tsc --noEmit
- cd frontend; npm run build
- git diff --check; audit every authored commit, staged and untracked path against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

Maintain Progress, Decisions, Blockers and Handoff in your NOTES.md. Record R2-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Prior handoff is preserved at fd7fe29:workstreams/frontend/NOTES.md.

Publish scoped commits via normal fast-forward push to remote main following prompts/TEAMMATE.md. Include a [R2-20260919][E] COMPLETE marker only after acceptance checks pass. Return the exact delivery SHA in your response, never as a self-reference in its own commit. Stop editing after confirmed publication until A reviews or reassigns. Publication is not integration/deployment acceptance.
