# C — R3-20260919

## Current A integration handoff — September 19, 2026

The user explicitly authorized A to commit and merge the stopped `worktree-w25-sparse-burst` worker. Source `a869f185e37a6b1547cedf0fb0c6cab896818c24` is integrated by `e289c7f`; original base `972c349`, pre-merge main `cb6a8b0`. The locked source checkout remains intact. No concurrent frontend work is included.

Status: SOURCE_INTEGRATED_DEVELOPMENT_CANDIDATE. Calibration SHA `8e3c1f65432f78815f75eab566867f1ea1637b9eb2ee673262d946f250242872` reproduced; 70 existing core tests pass. All25 rerun and NumPy oracle agree: W25 spread-down@72, W15 none, zero new normal-label alerts, all14 core payloads unchanged. `sparse_burst_w25/REPORT.md` records commands, evidence and package-import correction. Source runtime uses the supplement automatically when its artifact exists; accepted results/replay and deployed runtime remain unchanged.

Open: dedicated sparse-burst unit tests, synthetic controls, adversarial review and independent validation. W15 exclusion depends on first scan72 (alerts at56); excluding W07 from calibration adds W15/W18; fitting all18 normal-labeled wafers delays W25 to80. All wafers were inspected during development. These findings do not supersede the negative results from earlier candidates below. A publishes this source integration without deploying or promoting accepted replay.

## Prior C research handoff (preserved)

Status: READY_FOR_A (negative research). Shared main; published base 810b4ac9549a619ab09e9145f656c363c6d75035.
A alone commits/publishes; no C Git mutation, remote access or other agents.

## Progress
Completed temporal pooled-variance diagnosis, bounded stdlib candidate, all25/2000
evaluation,240 synthetic controls and36 passing workstream tests. All14 original
alert payloads remain exact; six supplementary alerts and zero removed. W25 emits
at80 in development diagnostics, but20/20 unchanged-variance mean-step controls
falsely alert. A accepted REJECT promotion and requested no further tuning.
A independently matched all1225 scans and14 baseline alerts and reproduced the
failure; final decision recorded in results/r3_research_review.json.

## Decisions
Author only workstreams/detection/**. Labels are evaluation metadata only.
All wafers are reused development data; no holdout or machine claims. No accepted
replay7/7 claim. Preserve original emissions and prediction model SHA; any future
approved supplement needs its own frozen artifact and provenance. B independently
reproduced alerts and identified quantile/persistence fragility.
R2 notes remain at ba89a991b6ca612917ef87ba0f54c5c3723d7867.

## Blockers
Production promotion blocked by scientific specificity failure. No unresolved
implementation/check failure: negative research delivery explicitly accepted by A.
Final-boundary tester receipt, active-site discovery, Edge latency/units/deadlines
remain unverified; no remote work performed.

## Handoff
Implementation SHA pending A publication; per-file SHA256s in round3/manifest.json.
Evaluation observed A's concurrent HEAD bd47d4d54f19a23ba9e98abc658dd4089508969b;
core input equivalence to assigned base and raw hashes recorded in round3/review.json.
Read ROUND3.md for full diagnosis, all25 alert table, added/removed signatures,
false-positive accounting, timing/state and non-approved minimal integration recipe.

Authored: NOTES.md, ROUND3.md, pooled_candidate.py, evaluate_round3.py,
synthetic_round3.py, test_pooled_candidate.py, diagnose_round3.py, audit_round3.py,
package_round3.py and round3/**. Inventory retains every historical file/reference.

Commands/results: unittest discover -s workstreams/detection -p test_*.py -v:
36 pass; evaluate_round3:25 wafers/2000 devices,14 exact baseline alerts,6 supplements,
20 failed scientific controls; audit_round3 and verify --contribution-ref 5f403bd:
pass evidence integrity (not promotion); package_round3 --verify: hashes pass;
git diff --check: pass. All Python commands use python -B -m workstreams.detection
module prefixes except unittest; exact commands/logs in ROUND3.md and round3/.

Next owner action: A commits/publishes the rejected research evidence. No C Git
mutation or outside-scope edits. Stop editing on delivery until A requests revision.
