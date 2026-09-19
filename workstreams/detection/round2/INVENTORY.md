# C workstream inventory — R2-20260919

Scope: every tracked/added deliverable under workstreams/detection. Existing R1
files remain unchanged, except the current NOTES.md prepared by A for R2.
No cleanup deletion is authorized or performed. Ignored Python bytecode is not
a deliverable; checks use -B. Paths below are relative to workstreams/detection.

Inventory checked with git ls-files, git status --short and rg references in
SYSTEM.md, team/, prompts/ and workstreams/. References are consumers or provenance
links, including dynamically constructed output paths; absence of a literal link
does not make retained evidence obsolete.

| File | Role and references | Disposition |
| --- | --- | --- |
| NOTES.md | SYSTEM/team/teammate prompt current C handoff; old notes at fd7fe29 | Update for R2 |
| PROPOSAL.md | R1 rejection; SYSTEM.md and current ROUND2.md link it | Retain unchanged |
| candidate.py | R1 candidate imported by evaluate.py/test_candidate.py; verify hashes | Retain unchanged |
| evaluate.py | R1 evaluator; imported by test_candidate.py/verify.py; PROPOSAL commands | Retain unchanged |
| test_candidate.py | 11 R1 tests; discovery and PROPOSAL command | Retain unchanged |
| verify.py | R1 immutable contribution audit; SYSTEM/team C acceptance command | Retain unchanged |
| baseline-run.log | PROPOSAL baseline command output | Retain unchanged |
| evaluation-run.log | PROPOSAL evaluator command output | Retain unchanged |
| test-run.log | PROPOSAL R1 test command output | Retain unchanged |
| verification-run.log | PROPOSAL R1 audit command output | Retain unchanged |
| evidence/baseline/summary.json | evaluate.py baseline comparison; profile_detector.py exact historical alert oracle | Retain unchanged |
| evidence/baseline/replay.jsonl | grp6_app.rehearse log from PROPOSAL baseline command | Retain unchanged |
| evidence/baseline/report.html | grp6_app.rehearse/report rendered evidence from PROPOSAL command | Retain unchanged |
| evidence/evaluation/calibration.json | evaluate.py output; verify.py calibration/hash checks; PROPOSAL | Retain unchanged |
| evidence/evaluation/candidate-scans.jsonl | evaluate.py output; verify.py persistence/axes checks; PROPOSAL | Retain unchanged |
| evidence/evaluation/initial-performance.json | Preserved early timings, explicitly described by PROPOSAL | Retain unchanged |
| evidence/evaluation/metrics.json | evaluate.py output; verify.py all-wafer/hash oracle; PROPOSAL | Retain unchanged |
| evidence/evaluation/representative-evidence.json | evaluate.py representative evidence output; PROPOSAL | Retain unchanged |
| profile_detector.py | New R2 stdlib CLI and sole optimization; test_profile.py, team C, ROUND2 | Add |
| test_profile.py | New differential/timing/ownership tests; discovery and profile code hashes | Add |
| ROUND2.md | R2 interpretation, limits and recommendation; NOTES | Add |
| round2/profile.json | R2 raw samples/full alerts/state/hash/environment evidence; ROUND2/NOTES | Add |
| round2/profile-run.log | Exact required CLI stdout/stderr; ROUND2/NOTES | Add |
| round2/tests.log | Captured 20-test acceptance output; ROUND2/NOTES | Add |
| round2/historical-audit.log | Captured immutable R1 audit output; ROUND2/NOTES | Add |
| round2/INVENTORY.md | This complete inventory and retention decisions; ROUND2/NOTES | Add |

Read-only external inputs: all 25 source_review/training/Data CSVs,
grp6_app/runtime.py, grp6_app/rehearse.py and grp6_app/artifacts/runtime.json.
The profile records raw SHA256 values. The existing R1 audit additionally checks
its own historical calibration/data/source hashes. No shared config, runtime,
artifact, root document, another workstream, deployment or VM path is authored.
