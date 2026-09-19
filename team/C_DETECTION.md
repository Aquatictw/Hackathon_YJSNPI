# C — W25 detection candidate and false-alarm evaluation

Read [SYSTEM.md](../SYSTEM.md), especially detection/evidence semantics. Produce an evaluated W25 spread-down candidate while preserving the machine-running detector. A alone integrates runtime changes.

## Write allowlist

Only files under `workstreams/detection/`: your NOTES.md, candidate/evaluator code, fixtures, metrics and proposal. Existing grp6_app, artifacts, results, source data, frontend and team briefs are read-only to C. No shared config/deploy/VM edits.
Maintain [your notes](../workstreams/detection/NOTES.md) using SYSTEM's notes rules.
Use local branch `teammate-c-detection` in your own checkout/worktree from A's exact current-round handoff SHA. Publish only to remote `main` using SYSTEM's minimal synchronization protocol and [teammate prompt](../prompts/TEAMMATE.md). Never publish a remote role branch. This assignment records the completed first round; start a new round only after A supplies its updated assignment, round ID and base SHA.

## Execute

1. Reproduce current detection over all 25 wafers and read existing spread/baseline/site diagnostics. Preserve W2's measured low-yield finding despite its normal label; labels are evaluation metadata only.
2. Implement one candidate for spread decrease inside the allowlist, with normal-baseline provenance, minimum sample/effect/persistence rules and bounded work. Do not encode wafer IDs or use future measurements/known answers as runtime inputs.
3. Compare unchanged baseline and candidate on every wafer: expected-category coverage, all additional alerts, normal-labeled-wafer false alarms, alerts per wafer, first detection in completed devices and scan latency. Disclose that reused/tuned wafers are not independent holdouts and exact onset is unknown.
4. Deliver candidate/evaluator, machine-readable metrics and a short recommendation with exact commands, thresholds, input hashes and representative evidence (series/site_series/baseline/score/count/direction/suggestion). Keep outputs inside workstreams/detection/.

## Acceptance

- A reproduces baseline and candidate results without altering runtime/artifacts/results. Include all categories and any regressions; report missed W25 honestly if the candidate still fails.
- W25 improvement is evaluated alongside false alarms, sample size and latency; a threshold change that merely fits W25 is not accepted as generalization proof.
- Evidence uses source units, device-order axes and detector scores rather than invented probabilities. Deliver an explicit promote/reject recommendation; promotion requires A review.

Before handoff audit your authored commits with `git show --name-only <commit>`, staged edits and `git status --short`; every authored path must be under workstreams/detection/. A cumulative base diff may include synchronized teammate work. Return base/branch SHA, commands/results and proposed A integration points.
