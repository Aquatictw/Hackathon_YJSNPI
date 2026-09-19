"""Adversarial raw-record fixtures for offline evidence interpretation."""
import copy
import json
import unittest

from workstreams.prediction.readiness_audit import (
    ROOT, audit_events, audit_receipts, output_path, strict_json, stats,
)


def fixture():
    scope = dict(run_id='run', tester='tester', source_mode='live', lot='lot',
                 wafer='01', test_id='test', touchdown=1)
    start = dict(scope, kind='test_start', event_id='start', sequence=1, sites=[1, 2])
    req = dict(scope, kind='prediction_request', event_id='request-event', sequence=2,
               request_id='request', stage=1, status='response_queued',
               predictions={'1': 10., '2': 20.}, coverage={'1': 1., '2': 1.},
               missing_features={'1': [], '2': []}, feature_counts={'1': 25, '2': 25},
               prediction_ids={'1': 'prediction-1', '2': 'prediction-2'},
               device_ids={'1': 'device-1', '2': 'device-2'}, latency_ms=2.,
               waited_for_measurements=False, lifecycle_changed=False, response=action())
    actuals = [dict(scope, kind='prediction_actual', event_id='actual-' + s,
                    sequence=2 + int(s), request_id='request', stage=1, site=s,
                    prediction_id='prediction-' + s, device_id='device-' + s,
                    predicted=float(s) * 10, actual=float(s) * 10 + .1) for s in ('1', '2')]
    return [start, req, *actuals]


def action():
    return json.dumps({'tester': 'tester', 'mtesterAction': [{'name': 'default',
                       'pool': [{'act_typ': 'wait', 'mactions': [{'reason': 'prediction 1: (1,10) (2,20)'}]}]}]})


class ReadinessChecks(unittest.TestCase):
    def test_complete_scope_and_unknown_metadata_remain_distinct(self):
        result = audit_events(fixture())
        self.assertEqual(result['summary']['readiness'], {'recorded_selected_inputs_ready': 2})
        self.assertEqual(result['summary']['actual_joins'], {'joined': 2})
        self.assertEqual(result['summary']['unknown_head_rows'], 2)
        self.assertEqual(result['summary']['unknown_attempt_rows'], 2)
        self.assertIsNone(result['full_measurement_completeness'])
        self.assertIsNone(result['effective_prediction_deadline_ms'])

    def test_missing_site_cannot_disappear_from_denominator(self):
        records = fixture()
        for field in ('predictions', 'coverage', 'missing_features', 'feature_counts', 'device_ids', 'prediction_ids'):
            records[1][field].pop('2')
        result = audit_events(records)['summary']
        self.assertEqual(result['site_rows'], 2)
        self.assertEqual(result['readiness']['unknown'], 1)
        self.assertEqual(result['missing_features']['unknown_rows'], 1)

    def test_incomplete_coverage_and_named_missing_input(self):
        records = fixture()
        records[1]['coverage']['1'] = .5
        records[1]['missing_features']['1'] = ['late-input']
        result = audit_events(records)['summary']
        self.assertEqual(result['readiness']['incomplete'], 1)
        self.assertEqual(result['missing_features']['names'], {'late-input': 1})

    def test_absent_flags_and_maps_are_unknown_not_false_or_empty(self):
        records = fixture()
        for field in ('coverage', 'missing_features', 'waited_for_measurements', 'lifecycle_changed'):
            records[1].pop(field)
        result = audit_events(records)['summary']
        self.assertEqual(result['readiness'], {'unknown': 2})
        self.assertEqual(result['waited_for_measurements'], {'true': 0, 'false': 0, 'unknown': 1})
        self.assertEqual(result['missing_features']['unknown_rows'], 2)

    def test_wrong_scope_never_joins(self):
        for field in ('run_id', 'tester', 'source_mode', 'lot', 'wafer', 'test_id', 'touchdown',
                      'stage', 'request_id', 'site', 'device_id', 'prediction_id', 'head', 'attempt'):
            with self.subTest(field=field):
                records = fixture()
                records[2][field] = 'other'
                result = audit_events(records)
                self.assertEqual(result['summary']['actual_joins'], {'unmatched': 1, 'joined': 1})

    def test_equal_values_with_distinct_actual_ids_are_ambiguous(self):
        records = fixture()
        records.append(dict(records[2], event_id='different', sequence=5))
        result = audit_events(records)
        self.assertEqual(result['rows'][0]['actual_join'], 'ambiguous_actual')
        self.assertIsNone(result['rows'][0]['actual'])

    def test_exact_event_retries_deduplicate(self):
        records = fixture()
        records += copy.deepcopy(records)
        result = audit_events(records)
        self.assertEqual(result['identity_audit']['exact_retries_removed'], 4)
        self.assertEqual(result['summary']['requests'], 1)
        self.assertEqual(result['summary']['actual_joins'], {'joined': 2})

    def test_conflicting_same_event_id_excludes_both_versions(self):
        records = fixture()
        records.append(dict(records[2], actual=999))
        result = audit_events(records)
        self.assertEqual(len(result['identity_audit']['conflicting_events_excluded']), 1)
        self.assertEqual(result['rows'][0]['actual_join'], 'unmatched')

    def test_duplicate_request_id_is_ambiguous_even_if_values_equal(self):
        records = fixture()
        records.insert(2, dict(records[1], event_id='another-request', sequence=5))
        result = audit_events(records)
        self.assertEqual(result['summary']['readiness'], {'invalid_identity': 4})
        self.assertEqual(result['summary']['actual_joins'], {'ambiguous_prediction': 4})

    def test_same_ids_in_separate_runs_remain_separate(self):
        records = fixture()
        other = [dict(e, run_id='other-run') for e in copy.deepcopy(records)]
        result = audit_events(records + other)
        self.assertEqual(result['summary']['requests'], 2)
        self.assertEqual(result['summary']['actual_joins'], {'joined': 4})

    def test_duplicate_prediction_ids_across_sites_fail_closed(self):
        records = fixture()
        records[1]['prediction_ids']['2'] = 'prediction-1'
        self.assertEqual(audit_events(records)['summary']['readiness'], {'invalid_identity': 2})

    def test_lifecycle_changed_flag_blocks_readiness_and_join(self):
        records = fixture()
        records[1]['lifecycle_changed'] = True
        result = audit_events(records)['summary']
        self.assertEqual(result['readiness'], {'lifecycle_changed': 2})
        self.assertEqual(result['actual_joins'], {'lifecycle_changed': 2})

    def test_boundary_between_request_and_actual_blocks_join(self):
        records = fixture()
        records.insert(2, dict(records[0], kind='boundary_end', event_id='boundary', sequence=5))
        self.assertEqual(audit_events(records)['summary']['actual_joins'], {'lifecycle_or_order_conflict': 2})

    def test_unknown_expected_sites_never_claims_complete(self):
        self.assertEqual(audit_events(fixture()[1:])['summary']['readiness'], {'unknown': 2})

    def test_invalid_stage_and_boolean_coverage_do_not_claim_readiness(self):
        for stage in (None, True, 0, 7, '1'):
            records = fixture()
            records[1]['stage'] = stage
            self.assertEqual(audit_events(records)['summary']['readiness'], {'unknown': 2})
        records = fixture()
        records[1]['coverage']['1'] = True
        self.assertEqual(audit_events(records)['rows'][0]['readiness'], 'unknown')

    def test_actual_before_request_and_prediction_disagreement_do_not_join(self):
        records = fixture()
        records[1], records[2] = records[2], records[1]
        self.assertEqual(audit_events(records)['rows'][0]['actual_join'], 'lifecycle_or_order_conflict')
        records = fixture()
        records[2]['predicted'] = 999
        self.assertEqual(audit_events(records)['rows'][0]['actual_join'], 'prediction_value_conflict')

    def test_nonfinite_or_null_actual_is_unavailable(self):
        for value in (None, 'NaN'):
            records = fixture()
            records[2]['actual'] = value
            self.assertEqual(audit_events(records)['rows'][0]['actual_join'], 'actual_missing_or_invalid')

    def test_invalid_action_json_keeps_sequence_failure(self):
        records = fixture()
        records.append(dict(records[0], kind='production_action_response', event_id='bad',
                            sequence=319, response='{"reason":"line1\nline2"}'))
        result = audit_events(records)['production_action_json']
        self.assertEqual(result['invalid'], 1)
        self.assertEqual(result['errors'][0]['sequence'], 319)

    def test_strict_json_rejects_duplicate_keys_and_nonfinite(self):
        for text in ('{"a":1,"a":2}', '{"a":NaN}'):
            with self.assertRaises(ValueError):
                strict_json(text)

    def test_unknown_latency_does_not_become_zero(self):
        self.assertEqual(stats([None, -1, '2'])['unknown'], 3)
        self.assertIsNone(stats([None])['max'])

    def test_output_cannot_escape_workstream(self):
        with self.assertRaises(ValueError):
            output_path(ROOT / 'results' / 'forbidden.json')
        with self.assertRaises(ValueError):
            output_path(ROOT / 'workstreams' / 'prediction' / '..' / 'forbidden.json')

    def test_receipt_requires_exact_action_and_adjacent_success(self):
        request = fixture()[1]
        raw = ('Actions => ' + action() + '\nNexus Process Action Time : 5 ms\n'
               'default Action Count: 1 Exec Pass: 1 Exec Fail: 0 Adaptive Test Execution Time: 10 ms\n').encode()
        result = audit_receipts([request], raw)
        self.assertEqual(result['matched_count'], 1)
        self.assertEqual(result['matches'][0]['nexus_process_action_ms'], 5)
        failed = raw.replace(b'Exec Pass: 1 Exec Fail: 0', b'Exec Pass: 0 Exec Fail: 1')
        self.assertEqual(audit_receipts([request], failed)['matched_count'], 0)
        wrong = dict(request, response=action().replace('prediction 1:', 'prediction 2:'))
        self.assertEqual(audit_receipts([wrong], raw)['matched_count'], 0)

    def test_receipt_cannot_be_reused_or_borrow_next_actions_success(self):
        request = fixture()[1]
        raw = ('Actions => ' + action() + '\nActions => {}\n'
               'default Action Count: 1 Exec Pass: 1 Exec Fail: 0').encode()
        self.assertEqual(audit_receipts([request], raw)['matched_count'], 0)
        good = ('Actions => ' + action() + '\ndefault Action Count: 1 Exec Pass: 1 Exec Fail: 0').encode()
        duplicate = dict(request, event_id='different-request')
        self.assertEqual(audit_receipts([request, duplicate], good)['matched_count'], 0)


if __name__ == '__main__':
    unittest.main()
