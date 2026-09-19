# TCCT / ProdMessage anomaly-text analysis and compatibility fix

Updated September 20, 2026 (workspace Asia/Taipei date). This sub-agent used local files only; remote findings below were explicitly supplied by coordinating A in this task, not independently collected here.

**Disposition: implement the scoped production transport workaround.** New evidence establishes that literal newlines reach MessUI before JSON parsing. The repaired diagnostic FIFO message parses and displays the original lines. This supersedes the initial local-only finding that receiver behavior was unproven. The workaround is implemented locally, with 75 core tests passing; it has not established a new end-to-end tester receipt.

## Exact receiver evidence supplied by A

| Observation | Evidence and limit |
| --- | --- |
| Running Message Center | Executable `/home/user/Case_Event/SmarTest/recipe/lib/util/MessUI`, observed PID 32733, SHA256 `6f190ad7a25fee27291c2f691e72b96357fd8cbb4bee1a979fea9300370a5622`. VNC shows Message Center V1.0.2 20260918. PID/version are observations, not permanent runtime identity. |
| Read and parse order | Debug symbols: `WorkThread::run` at `0x4178e0`; `WorkThread::read_from_fifo` at `0x417cbc` (confirmed by direct nm). Disassembly shows the received `std::string` logged before `actionInfo::processData`. Its parse call is `0x4199d8 -> 0x41a2fb`; nlohmann JSON v3.11.3 parses the object and accesses action/value fields, with exceptions caught. |
| Exact fresh rejected record | Extracted from the opening `{` before the first `44f001f09873` through the terminating `}` and newline. It has `action=text` and the three original alert strings in `value`, with two literal LF characters. Strict Python JSON parsing fails at line 1, column 160, character 159; `strict=False` retains action=text and both LFs. Because logging precedes parsing, these are malformed received bytes, not a logger showing already-decoded text. |
| Corrected receiver diagnostic | A permissively decoded that recorded value, prefixed `DIAGNOSTIC JSON REPLAY 20260920 - NOT A NEW TESTER RECEIPT\n`, serialized the object with `json.dumps`, and wrote 437 bytes once, nonblocking, to `/tmp/.acs_mess_info`. The prefix ends in an actual newline. |
| Diagnostic result | ProdMessage log timestamp `2026-09-20 01:38:35`: receives escaped JSON, then Insert text with all three original IDs and multiline text. VNC visibly displays the original anomaly lines. Timestamp is retained as reported, without asserting timezone alignment. This proves receiver parsing/display for diagnostic input, not deployment of this patch, new tester execution, or end-to-end runtime receipt. |

Fresh IDs: `44f001f09873`, `badb1939dc8b`, `884172dbb757`; complete run `b7deb9e5ff1641c6a16546eda090c121`. Raw receiver logs remain remote in `/home/user/Case_Event/dataflow_evaluation_20260920_Ns5HDP`. This report records A's observations; the local sub-agent has not downloaded the disassembly, receiver executable, raw logs or screenshot.

The proven requirement is valid JSON at the MessUI input boundary, with the text in action/value fields. For the tested text command, escaped newlines are decoded and displayed successfully. Text limits, FIFO framing under load, other commands, and arbitrary character rendering remain unverified. The evidence does not imply that every possible input must be accepted or that the TCCT writer itself has been repaired.

## Local source and historical evidence

`source_review/SmarTest/Case_Smt870/src/ACSTML/Predict.java:116-122,200,205` handles wait actions and concatenates unescaped data into an action=text/value JSON object before writing to the FIFO. `AdaptiveTest.java:94-100,179,184` does the same. These are prediction/adaptive writers; they are not claimed to be TCCT production source.

`source_review/Edge/oneAPI_py3.10/bin/sample.py:24,133-137,498` imports native libACSAction and distinguishes prediction set_wait/get from anomaly set_message/get_prod. The verified 66-file `grp6_sources_data.zip` contains neither the TCCT production writer nor MessUI source. The available incomplete Case_Event archive was not used as implementation evidence.

Historical `results/vm_production/grp6_core_prod3_evidence.jsonl:319` (run `d132133657be459e8e97b6fd442142e2`, September 19 UTC) contains a native acs_prod_var/msg action with three reasons joined by two literal LFs. Its strict JSON failure is column 256 / character 255. Its IDs are `bbe24a7975e6`, `7d9bfbbb7dd9`, `60d64c90b080`. These differ from the fresh IDs. The existing API normalizer repairs this outer JSON while preserving decoded message text; the new workaround addresses the later interpolation boundary.

## Implemented behavior

`MonitorCore.normalize_production_response` is unchanged: valid JSON passes byte-for-byte; native literal controls are escaped without changing decoded text; other malformed input follows the existing rejection/evidence path.

A separate `adapt_tcct_message_response` helper runs exactly once after normalization, only in the `key=prod_action` path. It accepts normalized native output and visits only:

```text
mtesterAction[] with name == "acs_prod_var"
  pool[] with act_typ == "msg"
    mactions[] with param == "msg" and string reason
```

Each matching reason is encoded as `json.dumps(reason, ensure_ascii=False)[1:-1]`. This prepares a JSON string fragment for the observed TCCT raw interpolation. The outer API response is then serialized normally. TCCT's outer decode exposes the fragment; inserting that fragment into the FIFO value produces strict JSON; MessUI's decode restores the original text. Literal backslash-n text remains literal backslash-n; actual newlines remain actual newlines after the final decode.

This helper is deliberately **not idempotent**: its input is normalized native JSON, never previously adapted output. Applying it twice would add an unwanted escaping layer. The callback path applies it once after get_prod; no encoding occurs in set_message, the native queue, predictions or action=list.

Plain ASCII and Unicode text without JSON-special characters yields no change; the entire response is returned byte-for-byte. Unrelated envelopes, unexpected container types and nonstring reasons are left alone. Valid envelopes with duplicate JSON keys are passed through unchanged rather than collapsed by reserialization. When any eligible reason changes, only those decoded reason fields change; other envelope values, action ordering and action counts are retained, although serialization formatting can change.

Evidence for an adapted response includes `transport_adaptation=tcct_msg_reason_json_fragment`, `raw_response`, `normalized_response` and final `response`. The old `normalization=escaped_control_characters` field appears only when the separate normalizer actually changed the raw response. Candidate IDs and `returned_to_callback_unconfirmed` are retained; no receiver confirmation is fabricated. Exported evidence carries the same fields.

**This is a transport workaround for the observed TCCT writer, not a native writer repair.** A future writer that correctly serializes reasons itself would require revisiting/removing this extra fragment encoding. API consumers on this route now see an encoded reason fragment for affected text; the intended compatibility target is the observed production TCCT→MessUI path.

## Regression validation

Final shared-checkout core suite: **75 tests passed, 0 failures, 0 errors, 0 skipped**, including **27 monitor tests**. Commands represented by the in-memory-output-capturing unittest runner:

```powershell
python -B -m unittest grp6_app.tests.test_monitor -v
python -B -m unittest discover -s grp6_app/tests -v
```

The first focused execution caught a test expectation indexing the wrong mixed-action fixture entry; that test index was corrected, then the full suite passed. No production change was needed for that test correction. Whitespace checks pass for both edited Python files.

Focused coverage:

1. Exact historical joined reason text and all three IDs survive native outer-JSON repair, outer decoding, TCCT raw interpolation and strict final JSON parsing. Original candidate IDs, raw/normalized/sent payloads and unconfirmed status are preserved in raw/exported evidence. The fixture is embedded so packaged tests need no historical capture file.
2. All 32 JSON control characters, quotes, trailing backslashes, literal escape sequences, Unicode including supplementary characters, and JSON-looking text round-trip without field injection or text alteration. Correctly escaped native input adapts without falsely reporting normalization.
3. Plain text and Unicode-only messages remain byte-for-byte unchanged. The normalizer's original byte-preservation and semantic-preservation contracts are tested directly and remain unchanged.
4. Mixed groups/pools/actions prove only matching msg reason fields change. Other fields, wait actions, other group names, malformed containers, missing/nonstring reasons and duplicate-key envelopes are preserved.
5. Prediction and action=list responses are returned unchanged even when a mock get() returns a production-shaped envelope that would otherwise be eligible for adaptation. Existing malformed-input, candidate-drain, channel separation and core tests continue to pass.

The tests simulate the observed two serialization boundaries with strict Python JSON parsing. They do not execute native TCCT or MessUI; A's separate diagnostic establishes actual MessUI parsing/display only for the tested recorded text.

Reproduce the exact historical boundary locally without generating files:

```python
import json
from pathlib import Path
from grp6_app.monitor import MonitorCore

path = Path('results/vm_production/grp6_core_prod3_evidence.jsonl')
with path.open(encoding='utf-8') as stream:
    record = next(row for row in map(json.loads, stream) if row['sequence'] == 319)
normalized = MonitorCore.normalize_production_response(record['response'])
original = json.loads(normalized)['mtesterAction'][0]['pool'][0]['mactions'][0]['reason']
adapted = MonitorCore.adapt_tcct_message_response(normalized)
fragment = json.loads(adapted)['mtesterAction'][0]['pool'][0]['mactions'][0]['reason']
fifo = '{"action":"text","value":"' + fragment + '"}'
assert json.loads(fifo) == {'action': 'text', 'value': original}
assert original.count('\n') == 2
for short_id in ('bbe24a7975e6', '7d9bfbbb7dd9', '60d64c90b080'):
    assert short_id in json.loads(fifo)['value']
```

## Changed paths and remaining proof

Only `grp6_app/monitor.py`, `grp6_app/tests/test_monitor.py` and this report were authored by this sub-agent. No model/detector/W2/W25, SYSTEM, deployment or Git mutation was made. No remote/browser action was taken by this sub-agent. Existing historical records remain unchanged.

Remaining acceptance belongs to coordinating A:

1. Verify the locally patched output through the actual TCCT path and correlate original anomaly IDs to successful MessUI parsing, Insert text and visible text. The direct-FIFO diagnostic deliberately bypassed runtime/TCCT and is not a new tester receipt.
2. Verify the actual running Edge image contains the intended patch. No local source/test result establishes deployment.
3. Establish a poll after final-boundary anomaly emission and successful final-message delivery. Valid API JSON, queued status and receiver arrival alone do not close this gate.

A owns any canonical SYSTEM update. No full run or deployment is claimed or requested by this sub-agent.

## Checked file identities

| File | SHA256 |
| --- | --- |
| Final `grp6_app/monitor.py` | `0f1cda18807c37ec07bf3c3bae2257f7ccd2122ab9c9401dcda5d4c7d49fa586` |
| Final `grp6_app/tests/test_monitor.py` | `7cb6adbef89e814ba662052683e205d1758b8dd76cfe3f5d3f19b75a73b2cb19` |
| Historical production JSONL | `dcd2fda6e8b09dd9fb51f9c713098c756abd1d24caece813a709af6bcd8fa4af` |
| Verified local source ZIP | `9d398727cbac6bfe0d51f2789b5c2fd423e7efab8ef112a0aca3d113aeed76ea` |
| MessUI, remotely reported by A | `6f190ad7a25fee27291c2f691e72b96357fd8cbb4bee1a979fea9300370a5622` |
