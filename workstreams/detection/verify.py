"""Audit the handoff evidence and ownership; does not modify any files."""
import argparse
import hashlib
import json
import subprocess

from .evaluate import BASE_SHA, ROOT, digest, json_digest, source_digest


def verify(contribution_ref=None):
    evidence = ROOT / "workstreams/detection/evidence/evaluation"
    metrics = json.loads((evidence / "metrics.json").read_text())
    calibration = json.loads((evidence / "calibration.json").read_text())
    scans = [json.loads(line) for line in (evidence / "candidate-scans.jsonl").read_text().splitlines()]
    recorded_sha = calibration.pop("calibration_sha256")
    assert recorded_sha == json_digest(calibration) == metrics["calibration_sha256"]
    for path, sha in metrics["input_sha256"].items():
        if digest(ROOT / path) != sha:
            # Git checkouts may differ only in Python source line endings.
            # Data/artifact hashes remain exact; never regenerate recorded hashes.
            source = (ROOT / path).read_bytes().replace(b"\r\n", b"\n")
            variants = [source, source.replace(b"\n", b"\r\n")]
            assert path.endswith(".py") and sha in [hashlib.sha256(value).hexdigest() for value in variants], f"Input hash changed: {path}"
            print(f"PASS: {path} matches recorded source with checkout line endings normalized.")
    for path, sha in metrics["evaluated_code_sha256"].items():
        assert source_digest(ROOT / path) == sha, f"Source hash changed: {path}"
    assert metrics["base_sha"] == BASE_SHA
    assert metrics["inputs_unchanged_after_run"]
    assert metrics["baseline_equals_fresh_rehearse_alerts"] is True
    assert metrics["baseline_alert_regressions"] == []
    wafers = metrics["wafers"]
    assert [wafer["wafer"] for wafer in wafers] == list(range(1, 26))
    assert sum(wafer["devices"] for wafer in wafers) == 2000
    assert metrics["baseline"]["expected_category_detected"] == 6
    assert metrics["candidate_combined"]["expected_category_detected"] == 6
    assert wafers[24]["candidate_additional_alerts"] == []
    assert wafers[1]["yield"] == 0.5375
    assert any(alert["kind"] == "low_yield" for alert in wafers[1]["combined_alerts"])
    assert metrics["additional_alert_count"] == 2
    assert metrics["baseline"]["normal_labeled_alert_wafers"] == [2]
    assert metrics["candidate_combined"]["normal_labeled_alert_wafers"] == [2]
    expected_additions = [(1, "2", "Main", 56), (23, "3", "Main.subflow2", 80)]
    actual_additions = []
    for wafer in wafers:
        for alert in wafer["baseline_alerts"]:
            assert alert in wafer["combined_alerts"]
        for alert in wafer["candidate_additional_alerts"]:
            actual_additions.append((wafer["wafer"], alert["site"], alert["family"], alert["completed_devices"]))
            matching = [scan for scan in scans if scan["wafer"] == wafer["wafer"] and
                        scan["site"] == alert["site"] and scan["family"] == alert["family"] and
                        scan["completed_devices"] <= alert["completed_devices"]]
            assert all(scan["passed"] for scan in matching[-2:]) and len(matching) >= 2
            assert matching[-1]["completed_devices"] - matching[-2]["completed_devices"] == 8
            assert alert["sample_count_per_test"] == len(alert["series"]) == 12
            assert len(alert["site_series"]) == 4
            assert alert["direction"] == "down" and alert["persistence_scans"] >= 2
            assert alert["score"] > 1 and alert["observed"] <= alert["reference"] * .7
            for orders in alert["site_series_device_order"].values():
                assert len(orders) == 12 and orders == list(range(orders[0], orders[-1] + 1))
    assert actual_additions == expected_additions
    # Compare both tracked diffs and every untracked path, not only the staging area.
    commands = [
        ["git", "diff", "--name-only", BASE_SHA],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ]
    if contribution_ref:
        # Integration includes other owners; audit C's immutable contribution only.
        commands = [["git", "diff", "--name-only", BASE_SHA, contribution_ref]]
    paths = set()
    for command in commands:
        paths.update(subprocess.check_output(command, cwd=ROOT, text=True).splitlines())
    assert all(path.startswith("workstreams/detection/") for path in paths), sorted(paths)
    print(f"PASS: 25 wafers / 2000 devices; exact baseline reproduction; 6/7 -> 6/7 coverage; 2 additional alerts.")
    print(f"PASS: all input/code hashes and calibration hash; W2 preserved; W25 miss explicit; evidence persistence/axes.")
    scope = "contribution" if contribution_ref else "changed/untracked"
    print(f"PASS: {len(paths)} {scope} paths are inside workstreams/detection/.")
    return paths


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contribution-ref", help="Audit ownership of this Git revision after integration; evidence hashes still check the working tree.")
    verify(parser.parse_args().contribution_ref)
