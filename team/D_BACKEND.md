# D: complete backend data and feature flows

Round: **R3-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. R2 is accepted at ba89a991b6ca612917ef87ba0f54c5c3723d7867; do not repeat completed R2 work. Start only when the user supplies the published R3 handoff SHA from A.

## Write allowlist

All paths below are relative to frontend/:

- `app/api/v1/**`, `db/**`, `drizzle/**` (including migration metadata); deployment/drizzle configuration files outside these directories remain A-owned.
- `contracts/edge-v1.schema.json`.
- `lib/rtdi/agent.ts`, `chat-handler.ts`, `command-contract.ts`, `exporter-wire.ts`, `http.ts`, `investigation-tools.ts`, `raw-payload.ts`, `repository.ts`, `server-config.ts`, `sse.ts`, `tool-contract.ts`, `wire.ts`; new backend helpers only as `lib/rtdi/backend-*.ts`.
- `tests/backend.test.mjs`, `tests/backend-*.test.mjs`; keep new fixtures inline/in these allowed test files.

Additional repository-root allowlist: `workstreams/backend/NOTES.md` only. Maintain [your notes](../workstreams/backend/NOTES.md) using SYSTEM's notes rules; this does not grant ownership of other files in that directory.
Everything else is read-only: UI libs (including assistant/contracts/replay-adapter), pages, scripts, manifests/lockfiles/configs/examples, non-v1 routes, core/exporter, results and team briefs. Request cross-boundary changes from A/E.
Use local branch `teammate-d-backend` in your own checkout/worktree from A's exact current-round handoff SHA. Publish only to remote `main` using SYSTEM's minimal synchronization protocol and [teammate prompt](../prompts/TEAMMATE.md). Never publish a remote role branch.  SYSTEM contains the sole API/status contract.


## Execute

Verify and fix persisted ingest-to-snapshot/SSE/measurement/incident/read-only investigation/command-status flows through actual SQLite persistence tests. Prioritize retry identity/transaction isolation, complete scoped evidence and truthful unavailable AI/command states needed by the frontend. Preserve wire/API shapes and seven command states; never acknowledge uncommitted content or fabricate model answers/receipts. Exercise duplicate/conflicting ingest, mixed valid/rejected records, wrong scope, empty/missing runs and safe feature errors. Record a feature-by-feature verified/unverified matrix in notes. Request A-owned configuration or contract changes explicitly. No secrets, auth redesign, dependencies, remote deployment or tester execution.

## Frozen inputs and dependencies

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter integration, preview deployment/shared contracts and VM work. No dependency on uncommitted R3 work from another role is required. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- cd frontend; node --test tests/backend*.test.mjs
- cd frontend; npm test
- cd frontend; npx tsc --noEmit
- cd frontend; npm run build
- git diff --check; audit authored commits, staged and untracked paths against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

At R3 startup replace current R2 notes with Progress, Decisions, Blockers and Handoff for R3; accepted R2 notes are preserved in history. Until startup the notes remain R2 COMPLETE and are not an R3 delivery. Record R3-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Accepted R2 handoff is preserved at ba89a991b6ca612917ef87ba0f54c5c3723d7867:workstreams/backend/NOTES.md.

Publish scoped commits via normal fast-forward push to remote main following prompts/TEAMMATE.md. Include a [R3-20260919][D] COMPLETE marker only after acceptance checks pass. Return the exact delivery SHA in your response, never as a self-reference in its own commit. Stop editing after confirmed publication until A reviews or reassigns. Publication is not integration/deployment acceptance.
