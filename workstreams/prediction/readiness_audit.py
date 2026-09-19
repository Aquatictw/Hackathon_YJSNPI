"""Offline audit of recorded raw JSONL; no machine or deadline acceptance.

Inputs are exact Git blobs at the R2 handoff BASE below: engineering/production-3
captures and recorded tester/strict-audit evidence. Checkout hashes are reported
separately because Windows may change text line endings. Git history is required.
Output is restricted to this workstream.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OWNED = Path(__file__).resolve().parent
BASE = 'a0d43172bbbdbde75fa1185d8037d4a35b787d4c'
INPUTS = {
    'engineering': 'results/vm_engineering/grp6_core_eng_evidence.jsonl',
    'production3': 'results/vm_production/grp6_core_prod3_evidence.jsonl',
    'engineering_tester': 'results/vm_engineering/grp6_core_eng_tester.edl',
    'production3_tester': 'results/vm_production/grp6_core_prod3_tester.txt',
    'engineering_audit': 'results/vm_engineering/grp6_core_eng_audit.json',
    'strict_audit': 'results/vm_production/strict_action_audit_20260919.json',
    'receipts': 'results/vm_production/tester_receipt_audit.json',
    'receiver': 'results/vm_production/receiver_observation_20260919.json',
    'runtime': 'grp6_app/artifacts/runtime.json',
}
SCOPE = ('run_id', 'tester', 'source_mode', 'lot', 'wafer', 'test_id', 'touchdown')
JOIN = SCOPE + ('stage', 'request_id', 'site', 'device_id', 'prediction_id')
OPTIONAL_SCOPE = ('head', 'attempt')
MAPS = ('predictions', 'coverage', 'missing_features', 'feature_counts',
        'prediction_ids', 'device_ids')


def strict_json(text):
    def constant(value):
        raise ValueError('Nonfinite JSON constant: ' + value)
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError('Duplicate JSON key: ' + key)
            out[key] = value
        return out
    return json.loads(text, parse_constant=constant, object_pairs_hook=unique)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def known(value):
    return value is not None and value != ''


def key(event, fields):
    return tuple(str(event.get(f)) if known(event.get(f)) else None for f in fields)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stats(values):
    valid = sorted(v for v in values if finite(v) and v >= 0)
    return {'known': len(valid), 'unknown': len(values) - len(valid),
            'min': min(valid) if valid else None, 'max': max(valid) if valid else None,
            'mean': sum(valid) / len(valid) if valid else None,
            'p95_nearest_rank': valid[math.ceil(.95 * len(valid)) - 1] if valid else None}


def flags(values):
    return {'true': sum(v is True for v in values),
            'false': sum(v is False for v in values),
            'unknown': sum(type(v) is not bool for v in values)}


def deduplicate(events):
    buckets, no_id = defaultdict(list), []
    for position, event in enumerate(events):
        item = dict(event, _position=position)
        identity = key(event, ('run_id', 'tester', 'source_mode', 'event_id'))
        if None in identity:
            no_id.append(item)
        else:
            buckets[identity].append(item)
    kept, conflicts, retries = no_id[:], [], 0
    for identity, items in buckets.items():
        bodies = {json.dumps({k: v for k, v in e.items() if k != '_position'},
                            sort_keys=True, allow_nan=False) for e in items}
        if len(bodies) != 1:
            conflicts.append({'identity': list(identity), 'occurrences': len(items)})
        else:
            kept.append(items[0])
            retries += len(items) - 1
    return sorted(kept, key=lambda e: e['_position']), {
        'exact_retries_removed': retries, 'conflicting_events_excluded': conflicts,
        'events_with_unknown_identity': len(no_id)}


def readiness(row, expected_sites_known):
    if row['identity_ambiguous']:
        return 'invalid_identity'
    if row.get('lifecycle_changed') is True:
        return 'lifecycle_changed'
    coverage, missing = row.get('coverage'), row.get('missing_features')
    if ((finite(coverage) and 0 <= coverage < 1) or
            (isinstance(missing, list) and len(missing) > 0) or
            row.get('status') == 'insufficient_current_data'):
        return 'incomplete'
    if (not expected_sites_known or None in key(row, JOIN) or
            not known(row.get('event_id')) or row.get('status') != 'response_queued' or
            type(row.get('stage')) is not int or row['stage'] not in range(1, 7) or
            row.get('lifecycle_changed') is not False or
            type(row.get('waited_for_measurements')) is not bool or
            not finite(row.get('prediction')) or coverage != 1 or
            not finite(coverage) or not isinstance(missing, list) or missing):
        return 'unknown'
    return 'recorded_selected_inputs_ready'


def summarize(rows, requests):
    return {
        'requests': len(requests), 'site_rows': len(rows),
        'readiness': dict(Counter(r['readiness'] for r in rows)),
        'actual_joins': dict(Counter(r['actual_join'] for r in rows)),
        'missing_features': {
            'known_rows': sum(isinstance(r['missing_features'], list) for r in rows),
            'unknown_rows': sum(not isinstance(r['missing_features'], list) for r in rows),
            'reported_missing_total': sum(len(r['missing_features']) for r in rows
                                          if isinstance(r['missing_features'], list)),
            'names': dict(Counter(n for r in rows if isinstance(r['missing_features'], list)
                                  for n in r['missing_features']))},
        'waited_for_measurements': flags([r.get('waited_for_measurements') for r in requests]),
        'lifecycle_changed': flags([r.get('lifecycle_changed') for r in requests]),
        'unknown_head_rows': sum(not known(r.get('head')) for r in rows),
        'unknown_attempt_rows': sum(not known(r.get('attempt')) for r in rows),
        'unknown_unit_rows': sum(not known(r.get('unit')) for r in rows),
        'observed_feature_counts': stats([r['feature_count'] for r in rows]),
        'callback_latency_ms': stats([r.get('latency_ms') for r in requests]),
        'callback_latency_when_waited_ms': stats([r.get('latency_ms') for r in requests
                                                 if r.get('waited_for_measurements') is True]),
    }


def audit_events(raw):
    events, identities = deduplicate(raw)
    requests = [e for e in events if e.get('kind') == 'prediction_request']
    actuals = [e for e in events if e.get('kind') == 'prediction_actual']
    starts = defaultdict(list)
    start_fields = ('run_id', 'tester', 'source_mode', 'test_id', 'touchdown')
    for e in events:
        if e.get('kind') == 'test_start':
            starts[key(e, start_fields)].append(e)
    request_counts = Counter(key(e, ('run_id', 'tester', 'source_mode', 'request_id'))
                             for e in requests)
    rows, request_site_metadata = [], []
    for req in requests:
        maps = {name: req.get(name) if isinstance(req.get(name), dict) else {} for name in MAPS}
        candidates = starts[key(req, start_fields)]
        expected = candidates[0].get('sites') if len(candidates) == 1 else None
        expected_known = (isinstance(expected, list) and bool(expected) and
                          all(known(s) for s in expected) and
                          candidates[0]['_position'] < req['_position'] and
                          len(set(map(str, expected))) == len(expected)
                          and None not in key(req, start_fields))
        sites = set().union(*(m.keys() for m in maps.values()))
        if expected_known:
            sites.update(map(str, expected))
        request_site_metadata.append({'event_id': req.get('event_id'),
                                      'expected_sites': list(map(str, expected)) if expected_known else None})
        for site in sorted(sites or {'unknown'}):
            row = {f: req.get(f) for f in SCOPE + OPTIONAL_SCOPE +
                   ('event_id', 'request_id', 'stage', 'sequence', 'status', 'unit',
                    'waited_for_measurements', 'lifecycle_changed', 'latency_ms')}
            row.update(site=site, prediction=maps['predictions'].get(site),
                       prediction_id=maps['prediction_ids'].get(site),
                       device_id=maps['device_ids'].get(site),
                       coverage=maps['coverage'].get(site),
                       missing_features=maps['missing_features'].get(site),
                       feature_count=maps['feature_counts'].get(site),
                       expected_site=(site in set(map(str, expected))) if expected_known else None,
                       _position=req['_position'],
                       identity_ambiguous=request_counts[key(req, ('run_id', 'tester', 'source_mode', 'request_id'))] > 1)
            row['readiness'] = readiness(row, expected_known and row['expected_site'])
            rows.append(row)
    prediction_counts = Counter(key(r, ('run_id', 'tester', 'source_mode', 'prediction_id'))
                                for r in rows if known(r.get('prediction_id')))
    actual_index = defaultdict(list)
    for actual in actuals:
        actual_index[key(actual, JOIN)].append(actual)
    used = set()
    boundaries = [e for e in events if e.get('kind') in
                  ('lot_start', 'wafer_start', 'test_start', 'boundary_end', 'disconnect', 'monitor_start')]
    for row in rows:
        pred_key = key(row, ('run_id', 'tester', 'source_mode', 'prediction_id'))
        if known(row.get('prediction_id')) and prediction_counts[pred_key] > 1:
            row['identity_ambiguous'] = True
            row['readiness'] = 'invalid_identity'
        matches = actual_index[key(row, JOIN)] if None not in key(row, JOIN) else []
        matches = [a for a in matches if all(
            (not known(row.get(f)) and not known(a.get(f))) or
            (known(row.get(f)) and known(a.get(f)) and str(row[f]) == str(a[f]))
            for f in OPTIONAL_SCOPE)]
        row['actual_event_id'], row['actual'] = None, None
        if row['identity_ambiguous']:
            state = 'ambiguous_prediction'
        elif row.get('lifecycle_changed') is True:
            state = 'lifecycle_changed'
        elif None in key(row, JOIN) or not known(row.get('event_id')):
            state = 'unknown_identity'
        elif len(matches) > 1:
            state = 'ambiguous_actual'
        elif not matches:
            state = 'unmatched'
        else:
            actual = matches[0]
            crossed = any(row['_position'] < b['_position'] < actual['_position'] and
                          key(b, ('run_id', 'tester', 'source_mode')) ==
                          key(row, ('run_id', 'tester', 'source_mode')) for b in boundaries)
            if crossed or actual['_position'] <= row['_position']:
                state = 'lifecycle_or_order_conflict'
            elif not known(actual.get('event_id')):
                state = 'unknown_identity'
            elif not finite(actual.get('actual')):
                state = 'actual_missing_or_invalid'
            elif actual.get('predicted') != row['prediction'] or not finite(row['prediction']):
                state = 'prediction_value_conflict'
            else:
                state = 'joined'
                used.add(actual['_position'])
                row['actual_event_id'], row['actual'] = actual['event_id'], actual['actual']
        row['actual_join'] = state
    groups = defaultdict(list)
    for row in rows:
        groups[key(row, ('run_id', 'tester', 'source_mode', 'lot', 'wafer', 'stage', 'site'))].append(row)
    by_scope_stage_site = []
    for identity, items in sorted(groups.items(), key=lambda item: repr(item[0])):
        positions = {r['_position'] for r in items}
        detail = dict(zip(('run_id', 'tester', 'source_mode', 'lot', 'wafer', 'stage', 'site'), identity))
        detail.update(summarize(items, [r for r in requests if r['_position'] in positions]))
        by_scope_stage_site.append(detail)
    action_errors, action_checked = [], 0
    for event in events:
        if event.get('kind') == 'production_action_response':
            action_checked += 1
            try:
                strict_json(event.get('response', ''))
            except (ValueError, TypeError) as exc:
                action_errors.append({'event_id': event.get('event_id'), 'sequence': event.get('sequence'),
                                      'error': str(exc), 'column': getattr(exc, 'colno', None)})
    sequence_scopes = defaultdict(list)
    for e in events:
        sequence_scopes[key(e, ('run_id', 'tester', 'source_mode'))].append(e.get('sequence'))
    sequences = []
    for identity, values in sequence_scopes.items():
        valid = [v for v in values if type(v) is int and v > 0]
        unique = sorted(set(valid))
        sequences.append({'scope': list(identity), 'known': len(valid), 'unknown': len(values) - len(valid),
                          'first': unique[0] if unique else None, 'last': unique[-1] if unique else None,
                          'duplicate_sequences': len(valid) - len(unique),
                          'missing_ranges': [[a + 1, b - 1] for a, b in zip(unique, unique[1:]) if b > a + 1]})
    return {
        'summary': summarize(rows, requests), 'event_counts': dict(Counter(e.get('kind') for e in events)),
        'identity_audit': identities, 'sequence_scopes': sequences,
        'request_sites': request_site_metadata, 'by_scope_stage_site': by_scope_stage_site,
        'rows': [{k: v for k, v in r.items() if k != '_position'} for r in rows],
        'actual_events': len(actuals), 'actual_events_not_uniquely_joined': len(actuals) - len(used),
        'production_action_json': {'checked': action_checked, 'invalid': len(action_errors), 'errors': action_errors},
        'error_event_counts': dict(Counter(e['kind'] for e in events if str(e.get('kind')).endswith('_error'))),
        'full_measurement_completeness': None, 'effective_prediction_deadline_ms': None,
        'machine_acceptance': 'UNVERIFIED; historical selected-input readiness only',
    }


def audit_receipts(requests, raw):
    """Correlate embedded UTF-8 action JSON, not the surrounding EDL format.

    Byte offsets work for both binary EDL and text. Only a 512-byte tail before
    the next action marker can supply the adjacent default execution result.
    Identical responses are ambiguous; never choose a request by value alone.
    """
    marker = b'Actions => '
    positions = [m.start() for m in re.finditer(re.escape(marker), raw)]
    decoder = json.JSONDecoder()
    receipts = []
    for index, position in enumerate(positions):
        start = position + len(marker)
        stop = positions[index + 1] if index + 1 < len(positions) else len(raw)
        window = raw[start:min(stop, start + 65536)]
        try:
            # latin1 gives one character per byte so offsets remain exact in EDL.
            _, end = decoder.raw_decode(window.decode('latin1'))
            parsed = strict_json(window[:end].decode('utf-8'))
        except (ValueError, UnicodeError):
            continue
        tail = window[end:end + 512]
        execution = re.search(rb'default Action Count: *([0-9]+) Exec Pass: *([0-9]+) Exec Fail: *([0-9]+)', tail)
        success = bool(execution and int(execution[1]) > 0 and
                       int(execution[1]) == int(execution[2]) and int(execution[3]) == 0)
        nexus = re.search(rb'Nexus Process Action Time *: *([0-9]+) ms', tail)
        adaptive = re.search(rb'Adaptive Test Execution Time: *([0-9]+) ms', tail)
        receipts.append({'action': parsed, 'byte_offset': position,
                         'line': raw.count(b'\n', 0, position) + 1, 'success': success,
                         'nexus_process_action_ms': int(nexus[1]) if nexus else None,
                         'adaptive_execution_ms': int(adaptive[1]) if adaptive else None})
    req_actions = []
    for request in requests:
        try:
            req_actions.append(strict_json(request.get('response', '')))
        except (TypeError, ValueError):
            req_actions.append(None)
    matches, unmatched = [], []
    for request, action_value in zip(requests, req_actions):
        choices = [r for r in receipts if r['success'] and r['action'] == action_value]
        if action_value is None or req_actions.count(action_value) != 1 or len(choices) != 1:
            unmatched.append(request.get('event_id'))
            continue
        receipt = choices[0]
        matches.append({'event_id': request.get('event_id'), 'request_id': request.get('request_id'),
                        'stage': request.get('stage'), **{k: v for k, v in receipt.items() if k not in ('action', 'success')}})
    return {'method': 'Unique exact parsed action JSON plus adjacent successful default execution; each receipt used once',
            'scope_limit': 'Tester action contains tester/payload only; capture association supplies run, not receiver run IDs',
            'edl_limit': 'Embedded action/log text correlation, not a complete EDL semantic decoder',
            'action_markers': len(positions), 'matched_count': len(matches),
            'unmatched_count': len(unmatched), 'unmatched_event_ids': unmatched, 'matches': matches,
            'nexus_process_action_ms': stats([m['nexus_process_action_ms'] for m in matches]),
            'adaptive_execution_ms': stats([m['adaptive_execution_ms'] for m in matches])}


def output_path(value):
    path = Path(value).resolve()
    if not path.is_relative_to(OWNED) or path == OWNED:
        raise ValueError('Output must stay in workstreams/prediction')
    return path


def build_report():
    files = {name: ROOT / path for name, path in INPUTS.items()}
    blobs = {name: subprocess.check_output(['git', 'show', BASE + ':' + INPUTS[name]], cwd=ROOT)
             for name in files}
    hashes = {name: {'path': INPUTS[name], 'sha256': hashlib.sha256(blobs[name]).hexdigest(),
                     'source': 'git:' + BASE + ':' + INPUTS[name],
                     'checkout_sha256': digest(path), 'checkout_bytes_equal': path.read_bytes() == blobs[name]}
              for name, path in files.items()}
    captures = {name: [strict_json(line) for line in blobs[name].decode('utf-8').splitlines()
                       if line.strip()] for name in ('engineering', 'production3')}
    results = {name: audit_events(records) for name, records in captures.items()}
    for name, records in captures.items():
        results[name]['tester_receipts'] = audit_receipts(
            [e for e in records if e['kind'] == 'prediction_request'], blobs[name + '_tester'])
    strict = strict_json(blobs['strict_audit'].decode('utf-8'))
    saved_receipts = strict_json(blobs['receipts'].decode('utf-8'))
    engineering = strict_json(blobs['engineering_audit'].decode('utf-8'))
    receiver = strict_json(blobs['receiver'].decode('utf-8'))
    prod = results['production3']
    reproduced = prod['tester_receipts']
    checks = {
        'engineering_hash_matches_saved_audit': hashes['engineering']['sha256'] == engineering['sha256'],
        'production_hash_matches_strict_audit': hashes['production3']['sha256'] == strict['sha256'],
        'production_hash_matches_receipts': hashes['production3']['sha256'] == saved_receipts['evidence_sha256'],
        'tester_hash_matches_receipts': hashes['production3_tester']['sha256'] == saved_receipts['tester_sha256'],
        'engineering_counts_match': results['engineering']['event_counts'] == engineering['event_counts'],
        'production_counts_match': prod['event_counts'] == strict['event_counts'],
        'strict_failure_reproduced': prod['production_action_json']['invalid'] == strict['production_action_json']['invalid']
            and [(e['event_id'], e['sequence'], e['column']) for e in prod['production_action_json']['errors']] ==
                [(e['event_id'], e['sequence'], e['response_column']) for e in strict['production_action_json']['errors']],
        'receipt_matches_reproduced':
            {(m['event_id'], m['request_id'], m['stage'], m['line']) for m in reproduced['matches']} ==
            {(m['event_id'], m['request_id'], m['stage'], m['tester_action_line']) for m in saved_receipts['matched']},
        'receipt_counts_reproduced': reproduced['matched_count'] == saved_receipts['prediction_receipts']
            and reproduced['unmatched_count'] == saved_receipts['unmatched_predictions'],
        'runtime_hash_matches_recorded_models': all(
            e.get('model_sha256') == hashes['runtime']['sha256']
            for events in captures.values() for e in events),
        'engineering_receipts_complete': results['engineering']['tester_receipts']['matched_count'] ==
            engineering['event_counts']['prediction_request'] and
            results['engineering']['tester_receipts']['unmatched_count'] == 0,
        'recorded_actuals_uniquely_joined': all(
            data['summary']['actual_joins'] == {'joined': data['actual_events']}
            and data['actual_events_not_uniquely_joined'] == 0 for data in results.values()),
        'no_conflicting_recorded_identities': all(
            not data['identity_audit']['conflicting_events_excluded'] for data in results.values()),
    }
    return {'round': 'R2-20260919', 'base_sha': BASE,
            'status': 'PASS' if all(checks.values()) else 'FAIL',
            'status_meaning': 'Audit consistency, not machine acceptance; historical action failure retained',
            'inputs': hashes, 'checks': checks, 'captures': results,
            'receiver_observation': {'anomaly_ids': receiver['anomaly_ids'],
                                     'acceptance': receiver['acceptance'],
                                     'timestamp_limit': receiver['timestamp_limit'],
                                     'original_remote_logs_rechecked': False},
            'limits': [
                'Sampled measurement rows do not prove all eligible inputs, units, scaling or flags.',
                'Selected-input readiness is recorded runtime metadata, not independent input reconstruction.',
                'Head/attempt and prediction timeout units are unknown; absent metadata is never zero.',
                'Callback latency and tester process/action timings have different boundaries.',
                'No wait-duration, expiry, missing-input, retest or reconnect stress acceptance from these captures.',
                'Raw actual events are logged at test end; their timestamps do not identify sensor acquisition time.',
                'Production sequence 319 remains invalid; anomaly receiver arrival is not execution/display.',
                'No new machine access, deployment, accuracy tolerance claim or model promotion.',
            ]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', default=str(OWNED / 'round2/readiness.json'),
                        help='JSON output under workstreams/prediction (default: round2/readiness.json)')
    args = parser.parse_args(argv)
    target = output_path(args.output)
    report = build_report()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'checks': report['checks'],
                      'captures': {name: data['summary'] for name, data in report['captures'].items()}}, indent=2))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
