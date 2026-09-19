# E: polished complete dashboard and replay experience

Round: **R3-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. R2 is accepted at ba89a991b6ca612917ef87ba0f54c5c3723d7867; do not repeat completed R2 work. Start only when the user supplies the published R3 handoff SHA from A.

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

Implement the user's requested dark mode across dashboard, /replay and /sandbox. Provide an accessible light/dark/system selector, follow the OS preference by default, and persist an explicit choice across navigation and reload. Use existing dependencies and theme primitives; preserve hydration correctness and readable charts, tables, dialogs, focus rings and unavailable states in both themes. Verify theme switching, persistence, system fallback, keyboard use and mobile contrast in an actual browser. Dark mode is required R3 work, not an optional follow-up.

Polish dashboard and /replay at desktop and mobile widths: clear load/reconnect/error/empty states, responsive evidence layout, keyboard/focus, readable units/source/freshness and consistent selected wafer/site/incident. Verify prediction, anomaly, evidence, persisted AI and command-status views; unavailable backend/AI needs truthful actionable states. Keep commands read-only; preserve R2 lifecycle isolation, /sandbox and API shapes. Make W25 display data-driven, never hardcode success before promoted evidence exists. Use local seeded data; inspect https://hackathon.aquatictw.com/ as read-only reference. Add focused behavior regressions, actual browser viewport/keyboard checks and a feature matrix in notes. VPS/dependencies/public snapshots remain A-owned.

## Frozen inputs and dependencies

A browser observation on the public preview: the empty state says "載入 D 的資料"; replace internal teammate jargon. AI is unconfigured on this VPS, but the question composer enables after snapshot load; make this state clear and actionable without promising a model response. Revision bd47d4d54f19a23ba9e98abc658dd4089508969b is deployed with 24 stage/site predictions, actual joins and selected measurement samples in the default replay seed through the existing raw exporter projection. Format excessive numeric precision for readability while retaining precise evidence. Keep source/units/receipt limits visible. The W25 R3 candidate failed mean-shift controls and is not promoted; the accepted replay still reports W25 as missed.

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter integration, preview deployment/shared contracts and VM work. No dependency on uncommitted R3 work from another role is required. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- cd frontend; npm test
- cd frontend; npx tsc --noEmit
- cd frontend; npm run build
- Perform the browser/keyboard scenarios above and record observed results.
- git diff --check; audit authored commits, staged and untracked paths against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

At R3 startup replace current R2 notes with Progress, Decisions, Blockers and Handoff for R3; accepted R2 notes are preserved in history. Until startup the notes remain R2 COMPLETE and are not an R3 delivery. Record R3-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Accepted R2 handoff is preserved at ba89a991b6ca612917ef87ba0f54c5c3723d7867:workstreams/frontend/NOTES.md.

Publish scoped commits via normal fast-forward push to remote main following prompts/TEAMMATE.md. Include a [R3-20260919][E] COMPLETE marker only after acceptance checks pass. Return the exact delivery SHA in your response, never as a self-reference in its own commit. Stop editing after confirmed publication until A reviews or reassigns. Publication is not integration/deployment acceptance.
