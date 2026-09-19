"""Independently audit saved out-of-fold predictions, scores, folds and hashes."""
import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def audit(results, report):
    results, report = Path(results), Path(report).resolve()
    if not report.is_relative_to(Path(__file__).resolve().parent):
        raise ValueError('Report must stay in workstreams/prediction')
    load = lambda name: json.loads((results / name).read_text(encoding='utf-8'))
    provenance, metrics, folds = load('provenance.json'), load('metrics.json'), load('fold_models.json')
    for path, expected in provenance['input_sha256'].items():
        if digest(path) != expected:
            raise AssertionError('Input hash mismatch: ' + path)
    for name, expected in provenance['output_sha256'].items():
        if digest(results / name) != expected:
            raise AssertionError('Output hash mismatch: ' + name)
    for name, expected in provenance['evaluator_sha256'].items():
        if digest(Path(__file__).with_name(name)) != expected:
            raise AssertionError('Evaluator hash mismatch: ' + name)
    manifest = json.loads(Path(provenance['arguments']['manifest']).read_text(encoding='utf-8'))
    for stage, entries in folds.items():
        for fold in entries:
            train, test = set(fold['train_wafers']), set(fold['test_wafers'])
            assert not train & test
            assert all(w % 5 == fold['fold'] for w in test)
            assert all(w % 5 != fold['fold'] for w in train)
            assert set(fold['primary']['features']) <= set(manifest['stages'][stage])
            assert set(fold['sparse8']['features']) <= set(fold['primary']['features'])
            assert len(fold['sparse8']['features']) == 8
    grouped = defaultdict(list)
    unique = set()
    with gzip.open(results / 'predictions.csv.gz', 'rt', encoding='utf-8', newline='') as handle:
        for row in csv.DictReader(handle):
            key = tuple(row[n] for n in ('lot', 'wafer', 'device_pid', 'site', 'stage', 'scenario'))
            assert key not in unique
            unique.add(key)
            assert int(row['wafer']) % 5 == int(row['fold'])
            value = lambda p: float(row[p]) if row[p] else None
            primary, sparse, fallback = map(value, ('primary', 'sparse8', 'fallback'))
            assert fallback == (primary if primary is not None else sparse)
            expected_source = 'primary' if primary is not None else 'sparse8' if sparse is not None else 'unavailable'
            assert row['fallback_source'] == expected_source
            for policy, pred in (('primary', primary), ('sparse8', sparse), ('fallback', fallback)):
                if pred is not None:
                    assert math.isfinite(pred)
                    if policy != 'fallback':
                        assert float(row[policy + '_coverage']) == 1.0
                if row['scenario'] == 'empty':
                    assert pred is None
                grouped[(row['stage'], row['scenario'], policy)].append(
                    (row['wafer'], row['site'], float(row['actual']), pred))
    checked = 0
    def check_rows(rows, expected):
        nonlocal checked
        errors = [pred - actual for _, _, actual, pred in rows if pred is not None]
        assert len(rows) == expected['target_count']
        assert len(errors) == expected['predicted_count']
        if rows:
            assert math.isclose(len(errors) / len(rows), expected['prediction_coverage'])
        actual_metrics = {'mae': sum(map(abs, errors)) / len(errors) if errors else None,
                          'rmse': math.sqrt(sum(e * e for e in errors) / len(errors)) if errors else None,
                          'worst_error': max(map(abs, errors)) if errors else None}
        for name, actual in actual_metrics.items():
            if actual is None:
                assert expected[name] is None
            else:
                assert math.isclose(actual, expected[name], rel_tol=1e-10, abs_tol=1e-12)
        checked += 1
    for (stage, scenario, policy), rows in grouped.items():
        saved = metrics['stages'][stage]['scenarios'][scenario]
        check_rows(rows, saved['all'][policy])
        for site, detail in saved['by_site'].items():
            check_rows([r for r in rows if r[1] == site], detail[policy])
        for wafer, detail in saved['by_wafer_site'].items():
            wafer_rows = [r for r in rows if r[0] == wafer]
            check_rows(wafer_rows, detail['all'][policy])
            for site, sub in detail['sites'].items():
                check_rows([r for r in wafer_rows if r[1] == site], sub[policy])
    regressions = {}
    for stage, detail in metrics['stages'].items():
        complete = detail['scenarios']['complete']
        regressions[stage] = {
            'sparse8_wafers_with_higher_mae': sum(
                v['all']['sparse8']['mae'] > v['all']['primary']['mae'] for v in complete['by_wafer_site'].values()),
            'sparse8_wafer_sites_with_higher_mae': sum(
                s['sparse8']['mae'] > s['primary']['mae']
                for v in complete['by_wafer_site'].values() for s in v['sites'].values()),
            'total_wafers': len(complete['by_wafer_site']),
            'total_wafer_sites': sum(len(v['sites']) for v in complete['by_wafer_site'].values())}
    result = {'status': 'pass', 'prediction_rows': len(unique), 'metric_groups_recomputed': checked,
              'hashes_verified': True, 'causal_fold_features_verified': True,
              'primary_preservation_and_empty_abstention_verified': True,
              'complete_data_regressions': regressions}
    report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    audit(args.results, args.report)
