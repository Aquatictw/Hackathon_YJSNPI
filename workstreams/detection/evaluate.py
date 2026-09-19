"""Reproducible development evaluation; every output stays in C's allowlist."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import statistics
import subprocess
import time

import numpy as np

from grp6_app.build_models import load_matrix
from grp6_app.rehearse import EXPECTED
from grp6_app.runtime import WaferDetector
from .candidate import DEFAULT_CONFIG, SpreadDecreaseCandidate, family_of

ROOT = Path(__file__).resolve().parents[2]
OWNED = ROOT / "workstreams/detection"
BASE_SHA = "eababfc4ffbb6c6faea4136b3dd9724773247aab"
CATEGORIES = ["site_imbalance", "low_yield", "mean_drift_up",
              "mean_drift_down", "spread_up", "spread_down"]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_digest(path):
    # Git may check out Python text with CRLF; source identity ignores that conversion.
    return hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def json_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def fit_calibration(artifact, names, records, matrix, input_hashes):
    """Fit frozen references/gates using only the existing normal-fit partition.

    No current/evaluation wafer influences thresholds. The 13 normal wafers were
    historically labeled/inspected; using them is development calibration only.
    Each contributes the same number of fixed-size site windows on this dataset.
    """
    cfg = dict(DEFAULT_CONFIG)
    fit_wafers = artifact["detector_calibration"]["normal_fit_wafers"]
    fit_rows = [i for i, row in enumerate(records) if int(row["Wafer"]) in fit_wafers]
    sites = sorted({records[i]["Site"] for i in fit_rows})
    families = {}
    for name in names:
        if name in artifact["baselines"]:
            families.setdefault(family_of(name), []).append(name)
    families = {family: tests for family, tests in families.items()
                if len(tests) >= cfg["minimum_family_tests"]}
    tests = [test for members in families.values() for test in members]
    positions = [names.index(test) for test in tests]
    samples = {site: [] for site in sites}
    sample_origins = {site: [] for site in sites}
    for wafer in fit_wafers:
        wafer_rows = [i for i in fit_rows if int(records[i]["Wafer"]) == wafer]
        for count in range(cfg["minimum_completed_devices"], len(wafer_rows) + 1, cfg["scan_interval_devices"]):
            for site in sites:
                rows = [i for i in wafer_rows[:count] if records[i]["Site"] == site]
                if len(rows) < cfg["window_per_site"]:
                    continue
                values = matrix[np.ix_(rows[-cfg["window_per_site"]:], positions)]
                samples[site].append(np.std(values, axis=0, ddof=0))
                sample_origins[site].append({"wafer": wafer, "completed_devices": count})
    sample_matrices = {site: np.array(values) for site, values in samples.items()}
    if any(len(values) == 0 for values in samples.values()):
        raise ValueError("Missing normal windows for a configured site")
    # Exclude a test everywhere if its normal windows are invalid/constant at any site.
    eligible = [test for j, test in enumerate(tests) if all(
        np.isfinite(values[:, j]).all() and (values[:, j] > 1e-12).all()
        for values in sample_matrices.values())]
    eligible_set = set(eligible)
    families = {family: [test for test in members if test in eligible_set]
                for family, members in families.items()}
    families = {family: members for family, members in families.items()
                if len(members) >= cfg["minimum_family_tests"]}
    reference = {}
    thresholds = {}
    normal_maxima = {}
    index = {test: i for i, test in enumerate(tests)}
    for site, values in sample_matrices.items():
        medians = np.median(values, axis=0)
        reference[site] = {test: float(medians[index[test]]) for members in families.values() for test in members}
        thresholds[site], normal_maxima[site] = {}, {}
        for family, members in families.items():
            js = [index[test] for test in members]
            fractions = np.mean(values[:, js] <= medians[js] * cfg["sd_ratio_limit"], axis=1)
            maximum = float(np.max(fractions))
            normal_maxima[site][family] = maximum
            thresholds[site][family] = max(cfg["minimum_hit_fraction"], maximum + cfg["normal_fraction_margin"])
    calibration = {
        "schema_version": 1, "method": "normal_reference_site_window_v1",
        "config": cfg, "families": families, "reference_sd": reference,
        "family_thresholds": thresholds, "normal_max_hit_fraction": normal_maxima,
        "normal_fit_wafers": fit_wafers, "normal_window_origins": sample_origins,
        "normal_window_count_per_site": {site: len(values) for site, values in samples.items()},
        "excluded_tests": [test for test in tests if test not in eligible_set],
        "source_artifact_sha256": input_hashes["grp6_app/artifacts/runtime.json"],
        "normal_input_sha256": {name: sha for name, sha in input_hashes.items()
                                 if any(f"_W{wafer:02d}_" in name for wafer in fit_wafers)},
        "reference_statistic": "median of per-site 12-device population SD at normal prefixes 48,56,64,72,80",
        "gate_statistic": "normal maximum fraction of tests at/below 0.70 reference SD, plus 0.02 absolute fraction; floor 0.05",
        "limitations": ["All wafers are reused development data; no independent holdout.",
                        "Overlapping windows and related tests are dependent; gates are not statistical false-alarm guarantees."],
    }
    calibration["calibration_sha256"] = json_digest(calibration)
    return calibration


def timing(values):
    return {"n": len(values), "median_ms": statistics.median(values) if values else None,
            "p95_ms": float(np.quantile(values, .95)) if values else None,
            "max_ms": max(values) if values else None}


def first_by_kind(alerts):
    return {kind: min((alert["completed_devices"] for alert in alerts if alert["kind"] == kind), default=None)
            for kind in CATEGORIES}


def aggregate(wafers, key):
    normal = [wafer for wafer in wafers if wafer["expected"] == "normal"]
    return {
        "expected_category_detected": sum(wafer["first_detection"][key].get(wafer["expected"]) is not None
                                          for wafer in wafers if wafer["expected"] != "normal"),
        "expected_anomaly_wafers": len(EXPECTED),
        "category_coverage": {kind: {
            "expected_wafers": [w["wafer"] for w in wafers if w["expected"] == kind],
            "detected_expected_wafers": [w["wafer"] for w in wafers if w["expected"] == kind and w["first_detection"][key][kind] is not None],
            "all_alerts": sum(a["kind"] == kind for w in wafers for a in w[key]),
        } for kind in CATEGORIES},
        "total_alerts": sum(len(w[key]) for w in wafers),
        "normal_labeled_alert_wafers": [w["wafer"] for w in normal if w[key]],
        "normal_labeled_alerts": sum(len(w[key]) for w in normal),
        "normal_labeled_wafer_count": len(normal),
        "normal_labeled_wafer_alert_rate": sum(bool(w[key]) for w in normal) / len(normal),
        "label_mismatch_note": "W2 has measured yield 53.75%; preserve its valid low-yield alert despite the normal label. Other alert truth is not independently adjudicated.",
    }


def run(output):
    output = Path(output).resolve()
    if output == OWNED or OWNED not in output.parents:
        raise ValueError("Output must be a subdirectory of workstreams/detection")
    output.mkdir(parents=True, exist_ok=True)
    data = ROOT / "source_review/training/Data"
    sources = [*sorted(data.glob("*_RawResult.csv")), ROOT / "grp6_app/artifacts/runtime.json",
               ROOT / "grp6_app/runtime.py", ROOT / "grp6_app/build_models.py", ROOT / "grp6_app/rehearse.py"]
    input_hashes = {path.relative_to(ROOT).as_posix(): digest(path) for path in sources}
    artifact = json.loads((ROOT / "grp6_app/artifacts/runtime.json").read_text())
    names, records, matrix = load_matrix(data)
    actual_wafers = sorted({int(row["Wafer"]) for row in records})
    if actual_wafers != list(range(1, 26)):
        raise ValueError("Acceptance requires all 25 source wafers")
    calibration = fit_calibration(artifact, names, records, matrix, input_hashes)
    write_json(output / "calibration.json", calibration)
    print(f"Calibration frozen: {sum(map(len, calibration['families'].values()))} tests; SHA256 {calibration['calibration_sha256']}", flush=True)
    wafers, all_scans = [], []
    times = {key: [] for key in ["baseline_scan", "candidate_scan", "candidate_add", "combined_scan"]}
    for wafer in actual_wafers:
        baseline = WaferDetector(artifact["baselines"], artifact["family_thresholds"])
        candidate = SpreadDecreaseCandidate(calibration)
        original, additions, scans = [], [], []
        rows = [i for i, row in enumerate(records) if int(row["Wafer"]) == wafer]
        for i in rows:
            row = records[i]
            values = {name: float(value) for name, value in zip(names, matrix[i]) if np.isfinite(value)}
            baseline.add(row["Site"], values, row["SBin"] == "1")
            started = time.perf_counter_ns()
            candidate.add(row["Site"], values)
            times["candidate_add"].append((time.perf_counter_ns() - started) / 1e6)
            started = time.perf_counter_ns()
            original.extend(baseline.analyze())
            baseline_ms = (time.perf_counter_ns() - started) / 1e6
            started = time.perf_counter_ns()
            additions.extend(candidate.analyze())
            candidate_ms = (time.perf_counter_ns() - started) / 1e6
            if candidate.latest_scans:
                scans.extend(candidate.latest_scans)
                times["candidate_scan"].append(candidate_ms)
            if baseline.completed % 8 == 0 and baseline.completed >= 24:
                times["baseline_scan"].append(baseline_ms)
                times["combined_scan"].append(baseline_ms + candidate_ms)
        original.extend(baseline.analyze(True))
        additions.extend(candidate.analyze(True))
        combined = sorted(original + additions, key=lambda alert: alert["completed_devices"])
        entry = {
            "wafer": wafer, "devices": len(rows), "yield": baseline.good / baseline.completed,
            "expected": EXPECTED.get(wafer, "normal"),
            "calibration_partition": "normal_fit_reused" if wafer in calibration["normal_fit_wafers"] else "development_check_reused",
            "baseline_alerts": original, "candidate_additional_alerts": additions, "combined_alerts": combined,
            "alert_counts": {"baseline": len(original), "candidate_additional": len(additions), "combined": len(combined)},
            "first_detection": {key: first_by_kind(alerts) for key, alerts in
                                  [("baseline_alerts", original), ("combined_alerts", combined)]},
            "candidate_strongest_scan": max(scans, key=lambda scan: scan["score"], default=None),
        }
        wafers.append(entry)
        all_scans.extend({"wafer": wafer, **scan} for scan in scans)
        print(f"W{wafer:02d}: baseline={len(original)} candidate_additions={len(additions)} strongest_score={entry['candidate_strongest_scan']['score']:.3f}", flush=True)
    baseline_summary = ROOT / "workstreams/detection/evidence/baseline/summary.json"
    baseline_match = None
    if baseline_summary.exists():
        fresh = json.loads(baseline_summary.read_text())["wafers"]
        baseline_match = all(w["baseline_alerts"] == next(b["alerts"] for b in fresh if b["wafer"] == w["wafer"]) for w in wafers)
        if not baseline_match:
            raise AssertionError("Baseline differs from fresh unmodified rehearse run")
    unchanged = all(digest(ROOT / name) == sha for name, sha in input_hashes.items())
    if not unchanged:
        raise AssertionError("Read-only input changed during evaluation")
    # The complete additional alert list is retained, including same-category duplicates.
    regressions = [w["wafer"] for w in wafers if any(a not in w["combined_alerts"] for a in w["baseline_alerts"])]
    metrics = {
        "mode": "offline development replay", "live_integration": "NOT TESTED",
        "base_sha": BASE_SHA,
        "evaluation_head_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "evaluated_code_sha256": {f"workstreams/detection/{name}": source_digest(OWNED / name)
                                  for name in ["candidate.py", "evaluate.py"]},
        "evaluated_code_hash_encoding": "UTF-8 source bytes with CRLF normalized to LF; input hashes remain raw bytes",
        "environment": {"python": platform.python_version(), "numpy": np.__version__,
                         "platform": platform.platform(), "timing_clock": "perf_counter_ns"},
        "input_sha256": input_hashes, "inputs_unchanged_after_run": unchanged,
        "baseline_equals_fresh_rehearse_alerts": baseline_match,
        "calibration_sha256": calibration["calibration_sha256"],
        "baseline": aggregate(wafers, "baseline_alerts"),
        "candidate_combined": aggregate(wafers, "combined_alerts"),
        "additional_alert_count": sum(len(w["candidate_additional_alerts"]) for w in wafers),
        "baseline_alert_regressions": regressions, "wafers": wafers,
        "latency": {key: timing(values) for key, values in times.items()},
        "latency_limits": "Single local replay; candidate scan timings include full configured windows, baseline includes scans from 24 devices. Combined is serial analyze cost; parsing, baseline add, I/O and SDK callbacks excluded. No live deadline acceptance.",
        "limitations": [
            "Expected labels are evaluation metadata only; candidate receives site plus current completed-device measurements.",
            "All 25 wafers were previously inspected; normal-check wafers 6/12/15/21/24 are not independent holdouts.",
            "Exploratory W25 site-window SD/minimum-normal ratios at lengths 8 and 12 were inspected before this final candidate. No generalization claim.",
            "Exact anomaly onset is unknown; first detection is completed-device position, not delay from onset.",
            "Population SD and series retain source CSV units; no confirmed physical units or probability interpretation.",
            "Requires trusted scope lifecycle and one add per completed device. Retest/head/missing-device semantics and machine latency remain untested.",
        ],
    }
    write_json(output / "metrics.json", metrics)
    with (output / "candidate-scans.jsonl").open("w", encoding="utf-8") as handle:
        for scan in all_scans:
            handle.write(json.dumps(scan, allow_nan=False) + "\n")
    evidence = {
        "baseline_examples": [{"wafer": w["wafer"], **alert} for w in wafers for alert in w["baseline_alerts"]],
        "all_candidate_alerts": [{"wafer": w["wafer"], **alert} for w in wafers for alert in w["candidate_additional_alerts"]],
        "w25_scans": [scan for scan in all_scans if scan["wafer"] == 25],
    }
    write_json(output / "representative-evidence.json", evidence)
    print(json.dumps({"baseline_coverage": metrics["baseline"]["expected_category_detected"],
                      "combined_coverage": metrics["candidate_combined"]["expected_category_detected"],
                      "additional_alerts": metrics["additional_alert_count"],
                      "normal_labeled_alert_wafers": metrics["candidate_combined"]["normal_labeled_alert_wafers"],
                      "latency": metrics["latency"]}, indent=2), flush=True)
    return metrics


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(OWNED / "evidence/evaluation"))
    run(parser.parse_args().output)
