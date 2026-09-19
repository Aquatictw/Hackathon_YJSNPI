# B burst follow-up - R3-20260919

## Progress

**READY_FOR_A.** Same-round independent sparse-burst follow-up is complete. B is quiescent after packaging and handoff. All new evidence is confined to this folder; all 56 pre-existing B files, including rejected R3 snapshots and the parent NOTES.md, remain preserved.

Round: R3-20260919. Shared branch: main. Assigned immutable data base: 810b4ac9549a619ab09e9145f656c363c6d75035. Follow-up starting HEAD: fca8912da03db0f00db94ff990e59f4d32bade4a. A alone owns Git mutations and publication; B has no delivery commit. Final observed HEAD and exact hashes are in validation.json.

## Decisions

The note's W25 7/40 versus 1/40 event counts and baseline q80 miss independently reproduce. This strengthens the sparse extreme-event diagnosis, not detector acceptance. The fixed B two-scan rule misses W25 and adds normal-labeled W15; a lower common gate that admits W25 also admits W15. Mean returns with unchanged noise and changed site exposure produce false spread interpretations, including with multiple-scan correction. See REPORT.md for exact controls, six disclosed sensitivity settings, normal-only calibration and leakage limits. No further tuning.

Normal-fit-only median/MAD; whole-wafer self-fit is explicitly noncausal diagnostic evidence. Fixed settings z20/min4, six subflows, prefix32..80/every8, min4 early events, two adjacent votes. All 25 wafers and all 18 normal labels evaluated. W2 low yield and other baseline categories are retained in copied immutable baseline records, not newly replayed. Accepted runtime remains 6/7, W25 missed. C's separate implementation requires separate A review.

## Blockers

No implementation/check blocker. Specificity failures are the negative research result. Reused development wafers, correlated tests and overlapping scans do not support independent-validation claims. No runtime, artifact, replay, deployment, browser, SSH/VNC, paid API or Git mutation.

## Handoff

REPORT.md is the final independent report; inventory.json lists all 18 follow-up files and their roles; validation.json records exact changed paths, file hashes, input/source identities and preservation checks. startup.json preserves the prior B inventory and reference-note identity.

Completed commands (not rerun during packaging):

1. `python -B -m workstreams.prediction.followup_burst_20260919.audit_bursts` — completed; all-wafer audit, 14 deterministic fixtures and 3,000 stationary synthetic trials; audit-run.log and JSON evidence retained.
2. `python -B -m workstreams.prediction.followup_burst_20260919.check_claims` — completed; baseline reconstruction, site-conditional arithmetic and W15/W25 threshold dominance; claim-checks-run.log retained.
3. `python -B -m unittest discover -s workstreams/prediction/followup_burst_20260919 -p test_*.py -v` — 24 tests passed, tests.log. The prior 68 B tests are reused for unchanged code, not freshly rerun.

Packaging checks: source/output/log hashes, all 56 preserved B files, all 26 immutable input hashes, complete inventory, reference copy, embedded execution identities, and read-only Git diff/status checks recorded in validation.json. Final hash checking does not rerun the evaluation.

Next owner action: A reviews and publishes this research handoff alongside C's separately reviewed evidence. No acceptance or promotion is requested. B stops editing after notification.
