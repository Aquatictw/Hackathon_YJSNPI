# C: generalizable spread-decrease candidate for W25

Round: **R3-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. R2 is accepted at ba89a991b6ca612917ef87ba0f54c5c3723d7867; do not repeat completed R2 work. Start only when the user supplies the published R3 handoff SHA from A.

## Write allowlist

Only files under `workstreams/detection/`: your NOTES.md, candidate/evaluator code, fixtures, metrics and proposal. Existing grp6_app, artifacts, results, source data, frontend and team briefs are read-only to C. No shared config/deploy/VM edits.
Maintain [your notes](../workstreams/detection/NOTES.md) using SYSTEM's notes rules.
R3 local subagent exception: work in the shared main checkout under the disjoint allowlist. A alone stages, commits, synchronizes and publishes. Do not create branches/worktrees or run mutating Git commands.


## Execute

Implement a workstream-local detector candidate that detects W25 spread decrease through general measurement statistics, without wafer-ID/label rules or future observations. Diagnose current family-gate failure; use per-site or pooled-baseline logic only when justified. Evaluate over all 25 wafers and synthetic stable/decrease/increase/missing-data controls. Preserve other six labeled categories, W2 valid low yield and truthful evidence; report every added/removed alert, detection position, parameter choice, baseline leakage risk, retained-state cost and latency. Deliver ROUND3.md, candidate implementation/tests and round3 hash evidence with a promote/reject recommendation. A alone promotes to core after independent B review. Reused wafers are development evidence, not a holdout.

## Frozen inputs and dependencies

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter integration, preview deployment/shared contracts and VM work. No dependency on uncommitted R3 work from another role is required. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- python -B -m unittest discover -s workstreams/detection -p test_*.py -v
- Run and document the new all-wafer evaluation and synthetic controls; record hashes, source revision and every failure.
- git diff --check; review authored paths against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

At R3 startup replace current R2 notes with Progress, Decisions, Blockers and Handoff for R3; accepted R2 notes are preserved in history. Until startup the notes remain R2 COMPLETE and are not an R3 delivery. Record R3-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Accepted R2 handoff is preserved at ba89a991b6ca612917ef87ba0f54c5c3723d7867:workstreams/detection/NOTES.md.

Return tested files, commands/results, evidence and recommendation to A; mark notes READY_FOR_A after checks. A commits/publishes and records delivery SHA. This explicit R3 subagent exception overrides per-worker branch/push instructions in prompts/TEAMMATE.md. Do not mark publication COMPLETE yourself. Stop editing after handoff until A requests revision.
