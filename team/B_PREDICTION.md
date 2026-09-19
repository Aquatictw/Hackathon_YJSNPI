# B — recorded prediction readiness audit

Round: **R2-20260919**. Base: the exact published handoff SHA supplied by A at dispatch. Read AGENTS.md, SYSTEM.md and prompts/TEAMMATE.md first. The legacy first round is already accepted; do not repeat it.

## Write allowlist

Only files under `workstreams/prediction/`, including your NOTES.md, evaluation code, candidate artifacts, fixtures and results. All existing core/models/manifest/results/source data and these team briefs are read-only to B. No dependency/config/deploy/VM edits.
Maintain [your notes](../workstreams/prediction/NOTES.md) using SYSTEM's notes rules.
Use local branch `teammate-b-prediction` in your own checkout/worktree from A's exact current-round handoff SHA. Publish only to remote `main` using SYSTEM's minimal synchronization protocol and [teammate prompt](../prompts/TEAMMATE.md). Never publish a remote role branch.


## Execute

Audit recorded engineering and production-3 JSONL and correlated receipt/strict-audit evidence. Report scoped request counts, readiness, missing inputs, wait/lifecycle flags, actual joins and callback timing by stage/site. Missing metadata is unknown, not zero. Sequence-319 malformed action remains a known historical failure; sampled measurements cannot prove full completeness. Add adversarial fixtures for incomplete coverage, wrong scope, duplicate IDs, ambiguous actuals and lifecycle changes. Deliver readiness_audit.py, test_readiness.py, round2/readiness.json and ROUND2.md with exact hashes and a concrete G1/G2 machine-test matrix. Preserve the round-1 model/evaluation outputs; no retraining or promotion.

## Frozen inputs and dependencies

Use core/artifacts, source data, historical machine receipts and API/UI contracts at the assigned base as read-only inputs. Preserve route/response shapes, seven command states and shared public signatures. Other roles work concurrently in separate checkouts: do not revert their changes. B/C produce offline evidence only. D/E need no new fields from one another. A owns exporter reliability, integration/shared contracts and VM work. Report required outside-scope edits by path/reason and continue independent work.

Inventory every file in your workstream and its references. Retain prior reproducibility evidence, including unsuccessful results. No cleanup deletion is authorized this round. New B/C CLIs must document default inputs and reject output outside their workstream.

## Acceptance checks

- python -B -m unittest discover -s workstreams/prediction -p 'test_*.py' -v
- python -B -m workstreams.prediction.readiness_audit --output workstreams/prediction/round2/readiness.json
- python -B -m workstreams.prediction.audit --results workstreams/prediction/results --report workstreams/prediction/round2/prior-audit.json
- git diff --check; audit every authored commit, staged and untracked path against the allowlist.

Run checks once on final implementation; after synchronization repeat only affected checks. A runs combined acceptance after all deliveries. A documented negative research result is acceptable; an implementation/check failure is BLOCKED until resolved or explicitly revised by A. Preserve live/auth/transport/units/deadline acceptance limits.

## Delivery and completion

Maintain Progress, Decisions, Blockers and Handoff in your NOTES.md. Record R2-20260919, IN_PROGRESS/BLOCKED/COMPLETE, exact base SHA, branch, implementation SHAs, paths, commands/results and evidence limits. Prior handoff is preserved at fd7fe29:workstreams/prediction/NOTES.md.

Publish scoped commits via normal fast-forward push to remote main following prompts/TEAMMATE.md. Include a [R2-20260919][B] COMPLETE marker only after acceptance checks pass. Return the exact delivery SHA in your response, never as a self-reference in its own commit. Stop editing after confirmed publication until A reviews or reassigns. Publication is not integration/deployment acceptance.
