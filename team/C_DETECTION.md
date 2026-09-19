# C — detector cost and output-equivalent optimization

Round: **R2-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. The legacy first round is already accepted; do not repeat it.

## Write allowlist

Only files under `workstreams/detection/`: your NOTES.md, candidate/evaluator code, fixtures, metrics and proposal. Existing grp6_app, artifacts, results, source data, frontend and team briefs are read-only to C. No shared config/deploy/VM edits.
Maintain [your notes](../workstreams/detection/NOTES.md) using SYSTEM's notes rules.
Use local branch `teammate-c-detection` in your own checkout/worktree from A's exact current-round handoff SHA. Publish only to remote `main` using SYSTEM's minimal synchronization protocol and [teammate prompt](../prompts/TEAMMATE.md). Never publish a remote role branch.


## Execute

Profile the unchanged production WaferDetector over all 25 wafers, separating ingestion, scans, finalization and total time. Evaluate at most one workstream-local output-preserving optimization; compare exact alert categories, positions and evidence to baseline. Do not retune thresholds or repeat W25 fitting. Report warmup/repetitions, p50/p95/max local latency, environment/hashes and retained-state bounds. Desktop timing does not prove SDK callback or TP deadline compliance. Preserve W2 findings, W25 miss and rejected round-1 evidence. Deliver profile_detector.py, test_profile.py, round2/profile.json and ROUND2.md with an explicit promote/reject/defer recommendation. An evaluated negative result is acceptable.

## Frozen inputs and dependencies

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter reliability, integration/shared contracts and VM work. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- python -B -m unittest discover -s workstreams/detection -p 'test_*.py' -v
- python -B -m workstreams.detection.profile_detector --output workstreams/detection/round2/profile.json
- python -B -m workstreams.detection.verify --contribution-ref 5f403bd
- git diff --check; audit every authored commit, staged and untracked path against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

Maintain Progress, Decisions, Blockers and Handoff in your NOTES.md. Record R2-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Prior handoff is preserved at fd7fe29:workstreams/detection/NOTES.md.

Publish scoped commits via normal fast-forward push to remote main following prompts/TEAMMATE.md. Include a [R2-20260919][C] COMPLETE marker only after acceptance checks pass. Return the exact delivery SHA in your response, never as a self-reference in its own commit. Stop editing after confirmed publication until A reviews or reassigns. Publication is not integration/deployment acceptance.
