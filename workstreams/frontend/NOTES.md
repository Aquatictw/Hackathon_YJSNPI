# E — Frontend notes

## Progress
- Assignment implemented locally; 40 tests, TypeScript, and production build pass on September 19, 2026. No deployment or VM work.
- Branch: `team/e-frontend`; base: `eababfc4ffbb6c6faea4136b3dd9724773247aab`.
- Isolated checkout: `/private/tmp/grp6-e-frontend`; initial status clean. Implementation commit is the commit containing this note; obtain its SHA with `git log -1 --format=%H`.

## Decisions
- All seven backend command states have truthful labels; ACK validation/schema use `received`, `queued_to_tester`, and `rejected`. Queueing never implies execution or receipt. Snapshot confirmation remains explicitly a backend report; optional receipt references are retained.
- Adapters retain 320-point series, site series, scalar thresholds, scores/suggestions, coverage, response status/receipt, request provenance and original normalized `source_batch`. Full source identity conflicts, including actual-event target changes, reject atomically. Scoped compound UI IDs avoid collisions across run/tester/device/site/attempt; source IDs stay unchanged inside `source_batch`.
- UI-only record-ID limit is 8192 to accommodate escaped compound IDs; scope/source IDs remain 120. Internal batches allow 200 records because 100 normalized events can each produce two UI records. Existing EventView/validatedView shape and assistant exports/behavior remain compatible; existing mismatched-scope filtering remains intact.
- Actuals join only unique matching run/tester/source plus supplied lot/wafer/device/site/stage/attempt. Out-of-order actuals within a batch work; retries cannot erase actuals; conflicts never replace prior values. Dashboard ambiguity/conflicts remain explicit and missing predictions remain empty.
- Charts use completed-device order, yield percentages and unknown-unit labels. Scalar threshold scale is unverified, so it is displayed separately rather than drawn as a measurement limit. Snapshot/SSE/chat control flow is unchanged; saved-source freshness remains visible on mobile.

## Blockers
- No remaining E implementation/check failure. Fresh end-to-end persisted chat/SSE reconnect and live transport acceptance were not performed; passing unit tests and local UI inspection do not establish those gates.
- **D requested:** `frontend/lib/rtdi/repository.ts` command snapshot projection omits `tester_receipt_id`. Expose the correlated reference if available; UI already accepts/displays it and explicitly labels absence. Current `tester_confirmed` display alone is not independent tester-receipt proof.
- **D requested:** `frontend/lib/rtdi/exporter-wire.ts` / `wire.ts` raw prediction/actual projection and original request provenance remain integration work. E consumes existing normalized per-site fields; no synthesized predictions. Clarify threshold scale before any measurement-limit overlay.
- **A requested:** promote accepted behavior/contract limits to `SYSTEM.md`; update any A-owned examples that use obsolete ACK states. E did not edit these paths or any manifests/configuration.

## Handoff
Changed paths (all within E allowlist):
- `frontend/app/{page.tsx,dashboard.css,sandbox/page.tsx}`
- `frontend/lib/rtdi/{contracts.ts,dashboard.ts,edge-adapter.ts,ui-predictions.ts}`
- `frontend/contracts/schemas.json`
- `frontend/tests/{dashboard.test.mjs,ui-adapters.test.mjs}`
- `workstreams/frontend/NOTES.md`

Fresh checks, run from `/private/tmp/grp6-e-frontend/frontend`:
- `npm test > /private/tmp/grp6-e-tests.log 2>&1` — exit 0; 40 passed, 0 failed/skipped. Includes existing backend/replay/assistant checks and new states, 320 samples, 100-event conversion, zero/missing values, multi-site/out-of-order joins, wrong scopes, retries and identity conflicts.
- `npx tsc --noEmit > /private/tmp/grp6-e-typecheck.log 2>&1` — exit 0; no diagnostics.
- `npm run build > /private/tmp/grp6-e-build.log 2>&1` — exit 0; “Build complete.” Vinext reports its existing route-classification limitation.
- `npm run dev -- --host 127.0.0.1 --port 5174 > /private/tmp/grp6-e-preview.log 2>&1` — local preview served at **http://localhost:5174**. Browser inspected dashboard at default width and 390×844: arrow-key tabs, visible focus, explicit empty predictions, contained horizontal table scrolling. Added and verified a keyboard-focusable table region; viewport override reset. Sandbox accepted synthetic two-site series and rendered both lines with unknown units/device-order axes. No AI or machine command invoked. Reduced-motion rules reviewed in `app/dashboard.css` and `app/globals.css`; emulated reduced-motion was not tested. Browser observations are recorded here; no screenshot files were committed.

From checkout root: `git diff --check` — exit 0. `git diff --name-only eababfc4ffbb6c6faea4136b3dd9724773247aab` plus `git ls-files --others --exclude-standard` — every one of 11 paths matched E's allowlist; no outside-scope changes.

Environment setup: offline install lacked cached packages; sandbox registry requests failed DNS. Approved `npm ci --ignore-scripts --cache /private/tmp/grp6-e-npm-cache` completed (676 packages). Premature type/build attempts while installation was incomplete failed; the final commands above were rerun successfully after installation. Lockfile/manifests remain unchanged. Logs are local temporary evidence, not committed artifacts; test sources reproduce checks.

Next for A: review/integrate `team/e-frontend`, coordinate the D fields above, and run combined persisted snapshot/SSE/chat plus real receipt acceptance.
