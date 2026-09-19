"""Summarize recorded SDK evidence; never infer tester receipt from a queue."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def audit(path):
    raw = Path(path).read_bytes()
    events, malformed = [], 0
    for line in raw.decode("utf-8").splitlines():
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("event must be an object")
            events.append(event)
        except (ValueError, TypeError):
            malformed += 1
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
    replay = any(e.get("mode") == "replay" for e in events)
    callback_gate = (not replay and malformed == 0 and errors == 0 and incomplete == 0
                     and kinds["monitor_start"] > 0 and kinds["measurement"] > 0
                     and kinds["test_start"] > 0 and kinds["device_end"] > 0
                     and all(s["complete_responses"] > 0 for s in stages.values()))
    return {"evidence_file": str(Path(path).resolve()),
            "sha256": hashlib.sha256(raw).hexdigest(), "event_counts": dict(kinds),
            "model_hashes": sorted({e["model_sha256"] for e in events if "model_sha256" in e}),
            "stages": stages, "malformed_lines": malformed, "errors": errors,
            "incomplete_predictions": incomplete, "replay_present": replay,
            "recorded_callback_gate": bool(callback_gate),
            "tester_receipt": "UNVERIFIED: inspect matching tester prediction and alert logs",
            "live_acceptance": "INCOMPLETE until VM provenance and tester receipt are verified"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("log")
    parser.add_argument("--output")
    args = parser.parse_args()
    result = json.dumps(audit(args.log), indent=2)
    print(result)
    if args.output:
        Path(args.output).write_text(result, encoding="utf-8")
