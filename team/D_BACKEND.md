# D — backend projection and integration contracts

Read [SYSTEM.md](../SYSTEM.md). Homepage snapshot/SSE/chat and real persisted AI already work locally. Close exporter projection gaps without rebuilding those integrations or claiming deployed transport.

## Write allowlist

All paths below are relative to frontend/:

- `app/api/v1/**`, `db/**`, `drizzle/**` (including migration metadata); deployment/drizzle configuration files outside these directories remain A-owned.
- `contracts/edge-v1.schema.json`.
- `lib/rtdi/agent.ts`, `chat-handler.ts`, `command-contract.ts`, `exporter-wire.ts`, `http.ts`, `investigation-tools.ts`, `raw-payload.ts`, `repository.ts`, `server-config.ts`, `sse.ts`, `tool-contract.ts`, `wire.ts`; new backend helpers only as `lib/rtdi/backend-*.ts`.
- `tests/backend.test.mjs`, `tests/backend-*.test.mjs`; keep new fixtures inline/in these allowed test files.

Everything else is read-only: UI libs (including assistant/contracts/replay-adapter), pages, scripts, manifests/lockfiles/configs/examples, non-v1 routes, core/exporter, results and team briefs. Request cross-boundary changes from A/E.
Branch `team/d-backend` from A's published cleanup commit in a separate checkout/worktree; record SHA. No direct main push. SYSTEM contains the sole API/status contract.

## Execute

1. Preserve bounded gzip/durable storage/idempotency/raw chunks. Project exporter prediction requests and actuals into scoped per-site records with stable IDs; preserve original request/device/run/tester identity. Device measurement access must be bounded; do not manufacture unavailable unit/attempt/completeness metadata.
2. Keep wire.ts and edge-v1.schema.json aligned. Preserve accepted exporter string-version/Unix-time input and numeric-version/ISO normalized output. Agree additive fields/join behavior with E through A; preserve existing fixtures and reject conflicting IDs.
3. Verify snapshot/SSE/retry/actual joins and command state/receipt guards using backend tests. Keep tools read-only and evidence-scoped. Incident lookup currently accepts optional run_id, not tester_id; document proposed API changes for A rather than silently changing consumers.
4. Return exact commands/results, migrations, field examples in the handoff, base/branch SHA and deployment prerequisites to A. Explicitly retain user-auth and actual-container acceptance gates unless independently implemented/tested.

## Acceptance

- Tests cover multi-site/repeated requests, duplicate delivery, conflicting identity, out-of-order/ambiguous actuals and cross-run/tester isolation. Original raw payloads remain recoverable; bounded ingest commits before ACK.
- Prediction/actual normalized records can reach existing snapshot/SSE consumers without losing scope or inventing receipt. Command states match SYSTEM; tester_confirmed requires correlated receipt semantics.
- From frontend run `node --test tests/backend*.test.mjs`, `npm test`, `npx tsc --noEmit`, `npm run build`; report failures accurately and ask A for dependency/config changes. Do not deploy/migrate a remote DB yourself.

Shared freeze: D may import but never edit assistant.ts exports instructions/demoAnswer/ChatMessage or E-owned EventView/validatedView. Preserve signatures/behavior expected across imports; A coordinates breaking changes. Check `git diff --name-only <cleanup-sha>` and untracked files against this allowlist before handoff.
