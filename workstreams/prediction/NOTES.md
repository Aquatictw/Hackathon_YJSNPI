# B — Prediction notes

## Progress

- Status: offline assignment implemented; full six-stage evaluation and independent evidence audit pass. Starting tree was clean.
- Completed: baseline aggregate metrics exactly reproduced; eight-feature fallback evaluated over 25 wafers / 2,000 devices with full stage/wafer/site metrics and four availability scenarios.
- Current task: commit and push assigned branch; final allowlist review passed.
- Last updated: 2026-09-19.

## Decisions

- Fixed before candidate evaluation: max_features=8, alpha=10, wafer modulo five folds; retain primary when available. No hyperparameter search. Fit selection/imputation/scaling only on training folds.
- Outputs and code stay under workstreams/prediction; production artifacts and core are read-only. Use Python -B to avoid writing caches outside the allowlist.
- Workstream-local .gitattributes preserves exact evidence/code bytes across checkout so recorded SHA256s remain usable; no shared Git configuration changed. Initial staged whitespace check flagged Windows CRLF; local cr-at-eol recognition fixes this while retaining normal whitespace checks.
- Keep primary: standalone sparse MAE regresses in five stages. Fallback raises synthetic 10% loss availability from 3.00–7.45% to 40.45–44.30%, preserving every primary prediction. This is not a live availability claim. Latest-flow loss remains unrecovered at stages 1/2/5/6; empty input always abstains.

## Blockers

- No blocker to offline delivery. Promotion remains unverified: no untouched holdout, accepted error tolerance, physical units/scaling, live missingness, SDK lifecycle or on-machine timing proof.
- Optional outside-scope proposal, requested owner A: grp6_app/runtime.py and grp6_app/artifacts/ for separate sparse model loading; grp6_app/monitor.py for post-wait fallback and source/coverage evidence while retaining lifecycle guards. None edited; details in EVALUATION.md.

## Handoff

- Branch: team/b-prediction. Base: eababfc4ffbb6c6faea4136b3dd9724773247aab.
- Worktree: C:/Users/USER/Documents/hackathon2026-b-prediction.
- Deliverables: candidate.py, evaluate.py, audit.py, test_prediction.py, EVALUATION.md, three logs, and results/ (candidate/fold artifacts, metrics, compressed predictions, hashes, checks, independent audit).
- Initial checks: git status --short (empty); git rev-parse eababfc (base above). Python 3.12.2 / NumPy 2.2.6; no dependency changes.
- `python -B -m unittest discover -s workstreams/prediction -p test_prediction.py -v` → exit 0, 13 pass; evidence workstreams/prediction/unit-tests.log.
- `python -B -m workstreams.prediction.evaluate --data source_review/training/Data --flows source_review/SmarTest/Case_Smt870/src/TestCase1 --runtime grp6_app/artifacts/runtime.json --manifest grp6_app/artifacts/manifest.json --reference grp6_app/artifacts/validation.json --reference results/model_revalidation/validation.json --output workstreams/prediction/results` → exit 0, six stages pass, both aggregate reference deltas zero, grouped metrics match tolerance, input hashes unchanged; evidence evaluation.log and results/checks.json.
- `python -B -m workstreams.prediction.audit --results workstreams/prediction/results --report workstreams/prediction/results/audit.json` → exit 0; 48,000 scoped rows and 9,360 metric groups verified; evidence audit.log and results/audit.json.
- Exact data/model/code hashes: results/provenance.json; results are from base plus workstream changes, not the VM. EVALUATION.md contains interpretation, regressions, latency limits and reproduction commands.
- `git diff --check` → exit 0; `git diff --name-only eababfc4ffbb6c6faea4136b3dd9724773247aab`, `git status --short` and untracked path review → every authored path under workstreams/prediction/.
- Commit / push pending. Next owner action after delivery: A reviews whether the fallback benefit justifies an error-tolerance-gated machine trial; no automatic promotion.
