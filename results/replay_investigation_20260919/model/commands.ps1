# Run from C:/Users/Aquatic/Documents/Hackathon_YJSNPI
# Recorded successful computation sequence. prepare.py intentionally refuses existing artifact directories.
# Do not rerun into this retained evidence directory; use a fresh isolated root if repeating.
$py = 'C:/Users/Aquatic/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $py -B results/replay_investigation_20260919/model/prepare.py
& $py -B -m grp6_app.rehearse source_review/training/Data --output results/replay_investigation_20260919/model/baseline --artifacts results/replay_investigation_20260919/model/baseline_artifacts > results/replay_investigation_20260919/model/baseline.log
& $py -B -m grp6_app.rehearse source_review/training/Data --output results/replay_investigation_20260919/model/candidate --artifacts results/replay_investigation_20260919/model/candidate_artifacts > results/replay_investigation_20260919/model/candidate.log
& $py -B -m grp6_app.build_models source_review --output results/replay_investigation_20260919/model/regression_rebuild > results/replay_investigation_20260919/model/regression_rebuild.log
& $py -B results/replay_investigation_20260919/model/analyze.py > results/replay_investigation_20260919/model/analysis.log
& $py -B results/replay_investigation_20260919/model/trajectories.py > results/replay_investigation_20260919/model/trajectories.log
& $py -B results/replay_investigation_20260919/model/finish.py
