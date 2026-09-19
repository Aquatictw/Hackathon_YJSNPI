# W25 sparse-burst source integration

September 19, 2026. **Development candidate; not independent validation or deployment acceptance.** User explicitly authorized committing and merging the stopped worker's uncommitted work. Source commit: `a869f185e37a6b1547cedf0fb0c6cab896818c24`, based on `972c349`; integrated with main `cb6a8b0` by merge `e289c7f`. The locked source worktree is retained.

## Result and mechanism

The core averages each test's spread change across sites, then takes the family 80th percentile across 500 subflow1 tests. Sparse device/test extremes are diluted: W25's device-72 score is about 0.188 versus its 0.358 gate. The supplement scores individual completed devices against frozen normal-fit site/test robust baselines. At least four tests above z=20 form a family burst; early burst counts must exceed both the normal-fit floor and the recent count, with one-sided Fisher p<=0.10. Scans start at 72 and recur every eight devices.

The independent integration rerun in `integration-results.json` reproduces W25 `spread_down@72` (6/36 early, 1/36 recent, floor 5, p about 0.053), W15 no alert, zero new alerts on normal-labeled wafers and the existing W2 low-yield alert. W23 retains spread-up@40; W1/W3/W9/W14/W18 retain their original categories. All 14 core alert payloads match the accepted replay under canonical JSON serialization; the accepted replay files themselves were not changed. The NumPy oracle has zero baseline, burst or floor mismatches and agrees on alerts; Fisher probability difference from the separate log-gamma calculation is <=6e-14.

Integration-run maximum scan times are 0.3798 ms supplement and 276.0938 ms core, with 320.2847 ms maximum combined add call. These are local Windows wall-clock observations under concurrent development, not Edge callback deadlines. Original worker timings remain in `results.json`; they are a different run.

## Verification and runtime integration

Commands ran in `.claude/worktrees/w25-sparse-burst` on the authored source before the conflict-free merge:

```text
python -B -m grp6_app.calibrate_burst
python -B -m unittest discover -s grp6_app/tests
python -B -m workstreams.detection.sparse_burst_w25.evaluate --output workstreams/detection/sparse_burst_w25/integration-results.json
git diff --check
```

Calibration reproduces SHA256 `8e3c1f65432f78815f75eab566867f1ea1637b9eb2ee673262d946f250242872`; all 70 existing core tests pass. The core `_analyze_core` AST is identical to the previous `analyze` body. Integration smoke checks verify missing/malformed/nonfinite-JSON artifacts disable the supplement, unknown sites and missing family data abstain, final-repeat scans emit nothing, and absent calibrated positions have no floor. These smoke checks are not a dedicated unit suite or an adversarial review. Source hashes in evaluator outputs describe the evaluated worktree bytes; checkout line-ending conversion can change byte hashes without changing Python semantics.

`RuntimeModels.detector()` enables the supplement from the neighboring artifact; Monitor and rehearsal use that factory and retain supplement SHA/status. Core model artifact SHA remains `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9`. Review found the selective runtime packager omitted the newly imported module; A's separate integration correction includes `sparse_burst.py`. No accepted `results/replay` regeneration, VPS release, competition-machine deployment or paid AI call occurred.
An isolated temporary bundle built with `deploy.package_grp6.main` passes ZIP/per-file integrity checks, imports `RuntimeModels` with active supplement and runs all 51 included tests successfully. The extracted bundle was tested outside the repository with inherited PYTHONPATH removed, then discarded; no release archive was installed or deployed.

## Limits and open work

All 25 wafers are reused development data. Normal-only fitting does not remove selection bias from choosing the rule after inspecting W15/W25. The false-positive separation is fragile:

1. W15 is excluded at the selected first scan of 72; at 56, W15/W18/W23 pass the diagnostic rule.
2. Leaving W07 out of normal-fit calibration lowers the floor and adds W15/W18.
3. Calibrating on all 18 normal-labeled wafers delays W25 to 80.

Dedicated detector unit tests (including the cases in the user's `prompts/message.txt`), synthetic control streams and independent adversarial review remain open. Future scientific acceptance must establish specificity and validation beyond these inspected wafers. Any accepted replay regeneration or machine deployment requires a separate promotion decision and receipt/load verification. Report, NOTES and SYSTEM status are now recorded; this does not close those scientific or runtime acceptance gates.
