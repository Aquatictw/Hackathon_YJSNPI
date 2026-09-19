# B — offline prediction proposals

Read [SYSTEM.md](../SYSTEM.md), especially requirements/runtime invariants. Preserve the machine-running baseline. A owns runtime promotion; your deliverable is a reproducible offline comparison.

## Write allowlist

Only files under `workstreams/prediction/`, including your NOTES.md, evaluation code, candidate artifacts, fixtures and results. All existing core/models/manifest/results/source data and these team briefs are read-only to B. No dependency/config/deploy/VM edits.
Maintain [your notes](../workstreams/prediction/NOTES.md) using SYSTEM's notes rules.
Use local branch `teammate-b-prediction` in your own checkout/worktree from A's exact current-round handoff SHA. Publish only to remote `main` using SYSTEM's minimal synchronization protocol and [teammate prompt](../prompts/TEAMMATE.md). Never publish a remote role branch. This assignment records the completed first round; start a new round only after A supplies its updated assignment, round ID and base SHA.

## Execute

1. Read current manifest/runtime/validation and results/model_revalidation/validation.json; reproduce the six-stage baseline without rewriting them. Add an evaluator under the allowlist with explicit input/output arguments.
2. Evaluate one useful candidate or missing-feature fallback against the unchanged baseline using wafer-separated folds. Fit preprocessing/selection only within training folds; enforce TP flow cutoffs and exclude future targets/final bins/labels.
3. Report stage/wafer/site MAE, RMSE, worst error, coverage, baseline comparison and measured inference latency. Exercise future-feature invariance, missing inputs, finite outputs and device/site isolation; disclose tuning/holdout limitations and unverified units.
4. Deliver candidate code/artifacts, machine-readable metrics and one short evaluation note inside workstreams/prediction, with exact commands, data/model hashes, branch/base SHA and proposed integration points for A.

## Acceptance

- A can reproduce baseline/candidate results from stated commands; all generated files stay inside the allowlist. No default build_models/calibrate invocation may overwrite production artifacts.
- All six stages obey causal boundaries; comparison includes regressions and unsuccessful candidates. Empty/insufficient data never becomes fabricated successful predictions.
- Proposal explains expected benefit/cost and what remains unverified on-machine. No claimed deployment, runtime replacement or guaranteed accuracy. A decides whether to promote.

Before handoff audit your authored commits with `git show --name-only <commit>`, staged edits and `git status --short`; every authored path must be under workstreams/prediction/. A cumulative base diff may include synchronized teammate work. Report required external edits to A instead of making them.
