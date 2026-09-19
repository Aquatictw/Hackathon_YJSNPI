"""Summarize recorded SDK evidence; never infer tester receipt from a queue."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def reject_json_constant(value):
    raise ValueError("Invalid JSON constant: " + value)


def audit(path, expected_devices=None, expected_touchdowns=None):
    raw = Path(path).read_bytes()
    events, malformed = [], 0
    production_json = {"checked": 0, "invalid": 0, "errors": []}
    for line_number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("event must be an object")
            events.append(event)
        except (ValueError, TypeError):
            malformed += 1
            continue
        if event.get("kind") == "production_action_response":
            production_json["checked"] += 1
            try:
                response = event.get("response")
                if not isinstance(response, str):
                    raise TypeError("response must be a JSON string; got " + type(response).__name__)
                # Validate the returned string, not raw_response or queue status.
                # Syntactic validity alone cannot establish tester receipt.
                json.loads(response, strict=True, parse_constant=reject_json_constant)
            except (ValueError, TypeError, RecursionError) as exc:
                detail = {"line": line_number, "sequence": event.get("sequence"),
                          "event_id": event.get("event_id"), "error": str(exc)}
                if isinstance(exc, json.JSONDecodeError):
                    detail.update(response_line=exc.lineno, response_column=exc.colno,
                                  response_position=exc.pos)
                production_json["errors"].append(detail)
                production_json["invalid"] += 1
    kinds = Counter(e.get("kind", "unknown") for e in events)
    stages = {str(s): {"requests": 0, "complete_responses": 0, "max_latency_ms": 0.0}
              for s in range(1, 7)}
    incomplete = 0
    for e in events:
        if e.get("kind") != "prediction_request":
            continue
        stage = stages.get(str(e.get("stage")))
        if stage is None:
            incomplete += 1
            continue
        stage["requests"] += 1
        stage["max_latency_ms"] = max(stage["max_latency_ms"], e.get("latency_ms", 0))
        coverage, predictions = e.get("coverage", {}), e.get("predictions", {})
        complete = (e.get("status") == "response_queued" and bool(coverage)
                    and set(coverage) == set(predictions)
                    and all(v == 1.0 for v in coverage.values())
                    and bool(e.get("response")))
        stage["complete_responses"] += int(complete)
        incomplete += int(not complete)
    errors = sum(kinds[k] for k in ("callback_error", "request_error", "action_error", "report_error"))
    replay = any(e.get("mode") == "replay" or e.get("source_mode") == "replay" for e in events)
    # One exported process: sequence starts at 1 even when lot run_id changes.
    # Overlapping snapshots must be deduplicated before auditing this file.
    sequences = [e.get("sequence") for e in events]
    valid_sequences = bool(sequences) and all(type(n) is int and n > 0 for n in sequences)
    missing_ranges = []
    if valid_sequences:
        previous = 0
        for number in sorted(set(sequences)):
            if number > previous + 1:
                missing_ranges.append([previous + 1, number - 1])
            previous = number
    sequence_complete = (valid_sequences and not missing_ranges
                         and len(set(sequences)) == len(sequences)
                         and kinds["monitor_start"] == 1)
    expected_counts_match = (expected_devices is not None and expected_touchdowns is not None
        and kinds["device_end"] == expected_devices
        and kinds["test_start"] == expected_touchdowns
        and kinds["prediction_actual"] == expected_devices * 6
        and all(s["complete_responses"] == expected_touchdowns for s in stages.values()))
    callback_gate = (not replay and malformed == 0 and errors == 0 and incomplete == 0
                     and production_json["invalid"] == 0
                     and kinds["monitor_start"] > 0 and kinds["measurement"] > 0
                     and kinds["test_start"] > 0 and kinds["device_end"] > 0
                     and all(s["complete_responses"] > 0 for s in stages.values()))
    return {"evidence_file": str(Path(path).resolve()),
            "sha256": hashlib.sha256(raw).hexdigest(), "event_counts": dict(kinds),
            "model_hashes": sorted({e["model_sha256"] for e in events if "model_sha256" in e}),
            "stages": stages, "malformed_lines": malformed, "errors": errors,
            "production_action_json": production_json,
            "incomplete_predictions": incomplete, "replay_present": replay,
            "recorded_callback_gate": bool(callback_gate and sequence_complete),
            "capture_integrity": {"single_process_sequence_complete": bool(sequence_complete),
                "missing_sequence_ranges": missing_ranges,
                "expected_devices": expected_devices, "expected_touchdowns": expected_touchdowns,
                "expected_counts_match": bool(expected_counts_match)},
            "complete_production_capture": bool(callback_gate and sequence_complete
                and expected_counts_match and kinds["lot_start"] == 1 and kinds["boundary_end"] > 0),
            "tester_receipt": "UNVERIFIED: inspect matching tester prediction and alert logs",
            "live_acceptance": "INCOMPLETE until VM provenance and tester receipt are verified"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("log")
    parser.add_argument("--output")
    parser.add_argument("--expected-devices", type=int)
    parser.add_argument("--expected-touchdowns", type=int)
    args = parser.parse_args()
    result = json.dumps(audit(args.log, args.expected_devices, args.expected_touchdowns), indent=2)
    print(result)
    if args.output:
        Path(args.output).write_text(result, encoding="utf-8")
