# B: independent W25 signal and false-alert audit

Round: **R3-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. R2 is accepted at ba89a991b6ca612917ef87ba0f54c5c3723d7867; do not repeat completed R2 work. Start only when the user supplies the published R3 handoff SHA from A.

## Write allowlist

Only files under `workstreams/prediction/`, including your NOTES.md, evaluation code, candidate artifacts, fixtures and results. All existing core/models/manifest/results/source data and these team briefs are read-only to B. No dependency/config/deploy/VM edits.
Maintain [your notes](../workstreams/prediction/NOTES.md) using SYSTEM's notes rules.
R3 local subagent exception: work in the shared main checkout under the disjoint allowlist. A alone stages, commits, synchronizes and publishes. Do not create branches/worktrees or run mutating Git commands.


## Execute

Build an independent workstream-local evaluation harness for W25 spread decrease using all 25 supplied wafers, with per-site/per-test dispersion summaries and comparisons against eligible normal-reference wafers. Identify plausible signal families and quantify effect sizes, sample counts, missing/nonfinite values and sensitivity to site pooling. Freeze an acceptance matrix for C/A: W25 spread-down coverage, all other labeled categories preserved, W2 valid low yield retained, no extra alerts on remaining normal-labeled wafers, synthetic no-change/shift/missing-data controls. Do not use wafer IDs/labels as runtime features. Deliver ROUND3.md, round3 diagnostics/provenance and reusable independent evaluation code/tests. These are reused development data, never independent validation. No runtime/model edits or retraining.

## Frozen inputs and dependencies

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter integration, preview deployment/shared contracts and VM work. No dependency on uncommitted R3 work from another role is required. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- python -B -m unittest discover -s workstreams/prediction -p test_*.py -v
- Run and document the new all-wafer evaluation and synthetic controls; record hashes, source revision and every failure.
- git diff --check; review authored paths against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

At R3 startup replace current R2 notes with Progress, Decisions, Blockers and Handoff for R3; accepted R2 notes are preserved in history. Until startup the notes remain R2 COMPLETE and are not an R3 delivery. Record R3-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Accepted R2 handoff is preserved at ba89a991b6ca612917ef87ba0f54c5c3723d7867:workstreams/prediction/NOTES.md.

Return tested files, commands/results, evidence and recommendation to A; mark notes READY_FOR_A after checks. A commits/publishes and records delivery SHA. This explicit R3 subagent exception overrides per-worker branch/push instructions in prompts/TEAMMATE.md. Do not mark publication COMPLETE yourself. Stop editing after handoff until A requests revision.
