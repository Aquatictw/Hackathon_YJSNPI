# E — Frontend notes

## Progress
- E implementation plus D-projection compatibility verified locally on September 19, 2026: 46 standard tests, 7 explicit D-code contract checks, TypeScript and production build pass. No deployment or VM work.
- Branch `team/e-frontend`; original base `eababfc4ffbb6c6faea4136b3dd9724773247aab`; isolated checkout `/private/tmp/grp6-e-frontend`. Previous E commit `be0f0887816832b41ee62e680659ae207fb454fc` preserved. Follow-up commit is the commit containing this note.
- Read-only upstream inspection: `origin/main` at `508e44c`; D projector at `2085284640bc8bcea7780c86e95bf3ea67c9327a`. No teammate branch was merged and no other checkout was switched.

## Decisions
- All seven backend command states render truthfully. Queueing is not execution or receipt. Optional receipt references remain explicit; absent references remain unknown.
- Retain 320-point/site series, thresholds, scores/suggestions, coverage/receipt, and normalized `source_batch`. Compound scoped UI IDs prevent run/tester/device/site/attempt collisions. UI-only IDs allow 8192 characters; source/scope IDs remain 120. Internal batches allow 200 records for 100 normalized events. Conflicting identities reject atomically; late actuals enrich without retry erasure.
- D's `original_request_id` and `source_event_id` now survive snapshot parsing, adapter conversion and source retention, with keyboard-accessible provenance disclosures. Original-request mismatch blocks joins even when per-site IDs match. Null/missing site predictions and unknown units remain explicit.
- `ui-wire.ts` accepts only D's two documented additive fields and delegates every other refinement to the read-only wire validators. It keeps E runnable on the requested base without merging D. The internal JSON schema includes a compatibility resource with those additions; a parity test detects drift from the shared wire schema. A may remove this compatibility layer/copy after advancing the shared base to D.
- Assistant exports and EventView/validatedView shape remain compatible. Snapshot/SSE/chat control flow is unchanged. Charts show completed-device order and yield percentages; unverified scalar thresholds are displayed separately from measurement plots. Existing reduced-motion rules remain unchanged.

## Blockers
- No remaining E implementation/check failure. Fresh persisted chat/SSE reconnect, cloud transport and real tester receipts remain unverified. Synthetic interface checks do not prove those gates.
- **D requested:** `frontend/lib/rtdi/repository.ts` command snapshot projection still omits `tester_receipt_id`; expose correlated references where available. E already accepts/displays them. `tester_confirmed` remains a backend report, not independently verified receipt.
- **A requested:** integrate E with the published D backend and update `SYSTEM.md`/A-owned examples. D raw prediction/actual projection is now published and E compatibility is verified; it is no longer an unavailable-field blocker. Combined persisted delivery/backfill still needs integration acceptance. Threshold scale remains unverified.

## Handoff
Cumulative changed paths, all E-allowlisted:
- `frontend/app/{page.tsx,dashboard.css,sandbox/page.tsx}`
- `frontend/lib/rtdi/{contracts.ts,dashboard.ts,edge-adapter.ts,ui-predictions.ts,ui-wire.ts}`
- `frontend/contracts/schemas.json`
- `frontend/tests/{dashboard.test.mjs,ui-adapters.test.mjs,ui-projection.test.mjs}`
- `workstreams/frontend/NOTES.md`

Fresh commands from `/private/tmp/grp6-e-frontend/frontend`:
- `npm test > /private/tmp/grp6-e-next-tests.log 2>&1` — exit 0; 46 passed, 0 failed/skipped. Includes unchanged backend/replay/assistant tests and UI states, missing/zero values, 320-point/100-event limits, scoped/conflicting/out-of-order joins and provenance validation.
- `GRP6_D_REVISION=2085284640bc8bcea7780c86e95bf3ea67c9327a node --test tests/ui-projection.test.mjs > /private/tmp/grp6-e-d-projection-check.log 2>&1` — exit 0; 7/7 pass. Loads D's actual projector and wire modules from git objects in memory; changes only import resolution, uses synthetic inputs, and writes no D files. Produces 3 projected records / 2 sites / 1 actual join, preserving null prediction, unknown units and provenance. Requires that commit fetched locally. Node emits an experimental `stripTypeScriptTypes` warning.
- `npx tsc --noEmit > /private/tmp/grp6-e-next-typecheck.log 2>&1` — exit 0, no diagnostics.
- `npm run build > /private/tmp/grp6-e-next-build.log 2>&1` — exit 0, “Build complete”; existing vinext route-classification warning remains.
- `npm run dev -- --host 127.0.0.1 --port 5174 > /private/tmp/grp6-e-next-preview.log 2>&1` — served http://localhost:5174; preview stopped afterward. Browser-only synthetic D-shaped JSON import displayed 1.20 / 1.30, unknown units, 100% coverage and queued response. Enter opened the provenance disclosure and exposed each per-site/original/source ID with visible focus. Expanded disclosure inspected at default and 390×844 widths; temporary viewport reset. No AI or machine command invoked. Reduced-motion is source-reviewed, not emulated. Observations are recorded here; no screenshots committed.

Root checks: `git diff --check` passed. `git diff --name-only eababfc4ffbb6c6faea4136b3dd9724773247aab` plus `git ls-files --others --exclude-standard` — all 13 cumulative changed/untracked paths match E's allowlist. No shared dependency/configuration changes. Logs are temporary local evidence; committed tests reproduce the checks.

Historical setup/verification: `be0f088` passed 40 tests/typecheck/build and mobile keyboard review. Offline/sandbox dependency setup initially failed; approved isolated `npm ci --ignore-scripts --cache /private/tmp/grp6-e-npm-cache` succeeded. The first publication timed out HTTP 408; HTTP/1.1 retry published `be0f088`. These are resolved earlier attempts, not current failures.

Next for A: review/integrate E's follow-up with D, expose command receipt references, and run combined persisted snapshot/SSE/chat plus real-receipt acceptance.
