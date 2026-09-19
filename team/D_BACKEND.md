# D — atomic command lifecycle guards

Round: **R2-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. The legacy first round is already accepted; do not repeat it.

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

Inspect and harden concurrent duplicate/conflicting command creation, expiry bypass using client occurred_at, stale state overwrites and wrong run/tester scope. Implement atomic, idempotent persistence retaining terminal states and truthful receipt provenance. Server time governs whether an unreceived queued command may be newly accepted; client timestamps cannot revive it. Already-received commands may report later outcomes under existing forward-only semantics. Preserve exact duplicate ACK retries; conflicting ACK content rejects. Add SQLite-backed interleaving/race regressions through the actual persistence path, plus expired, terminal and scope cases. Keep ACK storage/status update transactional. No tester command execution, identity-auth claim, remote migration/deployment or dependency changes.

## Frozen inputs and dependencies

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter reliability, integration/shared contracts and VM work. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- cd frontend; node --test tests/backend*.test.mjs
- cd frontend; npm test
- cd frontend; npx tsc --noEmit
- cd frontend; npm run build
- git diff --check; audit every authored commit, staged and untracked path against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

Maintain Progress, Decisions, Blockers and Handoff in your NOTES.md. Record R2-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Prior handoff is preserved at fd7fe29:workstreams/backend/NOTES.md.

Publish scoped commits via normal fast-forward push to remote main following prompts/TEAMMATE.md. Include a [R2-20260919][D] COMPLETE marker only after acceptance checks pass. Return the exact delivery SHA in your response, never as a self-reference in its own commit. Stop editing after confirmed publication until A reviews or reassigns. Publication is not integration/deployment acceptance.
