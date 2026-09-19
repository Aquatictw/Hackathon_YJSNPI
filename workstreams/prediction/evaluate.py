"""Reproduce the frozen baseline and evaluate a predeclared sparse fallback.

Run from the repository root with python -B -m workstreams.prediction.evaluate.
All input paths and the output directory are explicit. Outputs are constrained to
this workstream. No core builder entry point or production artifact is written.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import platform
import subprocess
import time
from pathlib import Path

import numpy as np

from grp6_app.build_models import fit_linear, flow_manifest, infer_matrix, load_matrix
from grp6_app.data import TARGETS
from grp6_app.runtime import RuntimeModels
from .candidate import SparseFallback, strict_predict

BASE = 'eababfc4ffbb6c6faea4136b3dd9724773247aab'
POLICIES = ('primary', 'sparse8', 'fallback')
SCENARIOS = ('complete', 'missing_random_10pct', 'latest_flow_missing', 'empty')
SEED = 20260919


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def output_directory(path):
    path = Path(path).resolve()
    allowed = Path(__file__).resolve().parent
    if not path.is_relative_to(allowed) or path == allowed:
        raise ValueError('Output must be a subdirectory of workstreams/prediction')
    # Refuse to replace existing symlinked files outside this workstream.
    for name in ('metrics.json', 'candidate.json', 'fold_models.json', 'predictions.csv.gz',
                 'summary.csv', 'provenance.json', 'checks.json'):
        if not (path / name).resolve().is_relative_to(allowed):
            raise ValueError('Output file escapes workstream: ' + name)
    return path


def fit_pair(x, y, features):
    if len(y) < 2 or not features or not np.isfinite(y).all():
        raise ValueError('Insufficient training data or invalid targets')
    if not np.any(np.isfinite(x)):
        raise ValueError('No finite training features')
    return (fit_linear(x, y, features),
            fit_linear(x, y, features, max_features=8, alpha=10.0))


def strict_matrix(model, matrix, names):
    selected = matrix[:, [names.index(n) for n in model['features']]]
    coverage = np.isfinite(selected).mean(axis=1)
    prediction = infer_matrix(model, matrix, names)
    prediction[(coverage != 1) | ~np.isfinite(prediction)] = np.nan
    return prediction, coverage


def score(y, prediction, train_mean, input_coverage):
    eligible = np.isfinite(y)
    emitted = eligible & np.isfinite(prediction)
    errors = prediction[emitted] - y[emitted]
    n, total = int(emitted.sum()), int(eligible.sum())
    return {'target_count': total, 'predicted_count': n,
            'prediction_coverage': n / total if total else None,
            'selected_input_coverage_mean': float(np.mean(input_coverage[eligible])) if total else None,
            'mae': float(np.mean(abs(errors))) if n else None,
            'rmse': float(np.sqrt(np.mean(errors ** 2))) if n else None,
            'worst_error': float(np.max(abs(errors))) if n else None,
            'train_mean_mae_same_rows': float(np.mean(abs(train_mean[emitted] - y[emitted]))) if n else None}


def comparison(y, primary, candidate):
    valid = np.isfinite(y)
    common = valid & np.isfinite(primary) & np.isfinite(candidate)
    added = valid & ~np.isfinite(primary) & np.isfinite(candidate)
    lost = valid & np.isfinite(primary) & ~np.isfinite(candidate)
    return {'common_count': int(common.sum()), 'added_count': int(added.sum()),
            'lost_count': int(lost.sum()),
            'mae_delta_common_rows': float(np.mean(abs(candidate[common] - y[common]))
                                           - np.mean(abs(primary[common] - y[common]))) if common.any() else None,
            'added_rows_mae': float(np.mean(abs(candidate[added] - y[added]))) if added.any() else None,
            'added_rows_worst_error': float(np.max(abs(candidate[added] - y[added]))) if added.any() else None}


def summarize(y, preds, means, coverage, mask):
    result = {p: score(y[mask], preds[p][mask], means[mask], coverage[p][mask]) for p in POLICIES}
    result['versus_primary'] = {p: comparison(y[mask], preds['primary'][mask], preds[p][mask])
                                for p in ('sparse8', 'fallback')}
    return result


def scenario_matrix(matrix, names, allowed, scenario, stage):
    result = matrix.copy()
    if scenario == 'missing_random_10pct':
        # Mask depends only on seed/stage/row/column, never targets or selected features.
        missing = np.random.default_rng(SEED + stage).random(matrix.shape) < 0.1
        result[missing] = np.nan
    elif scenario == 'latest_flow_missing':
        prefix = 'Main.IDDQ_flow.' if stage == 1 else 'Main.subflow' + str(stage - 1) + '.'
        columns = [i for i, n in enumerate(names) if n in allowed and n.split('_', 1)[1].startswith(prefix)]
        if not columns:
            raise ValueError('No features found for missing-flow stress scenario')
        result[:, columns] = np.nan
    elif scenario == 'empty':
        result[:] = np.nan
    elif scenario != 'complete':
        raise ValueError('Unknown scenario')
    return result


def latency(primary, sparse, stage, snapshots):
    fallback = SparseFallback(primary, {str(stage): sparse})
    functions = {'primary': lambda v: primary.predict(stage, v),
                 'sparse8': lambda v: strict_predict(sparse, v),
                 'fallback': lambda v: fallback.predict(stage, v)}
    result = {}
    for policy, fn in functions.items():
        for values in snapshots:
            fn(values)
        samples = []
        for _ in range(5):
            for values in snapshots:
                start = time.perf_counter_ns()
                fn(values)
                samples.append((time.perf_counter_ns() - start) / 1000)
        result[policy] = {'n': len(samples), 'unit': 'microseconds',
                          'p50': float(np.percentile(samples, 50)),
                          'p95': float(np.percentile(samples, 95)),
                          'p99': float(np.percentile(samples, 99)), 'max': max(samples)}
    return result


def validate_reference(stages, reference):
    differences = {}
    for stage, detail in stages.items():
        actual = detail['historical_baseline_reproduction']
        expected = reference['metrics'][stage]
        differences[stage] = {k: abs(actual[k] - expected[k]) for k in expected}
        for key in expected:
            if not np.isclose(actual[key], expected[key], rtol=1e-8, atol=1e-10):
                raise AssertionError(f'Baseline mismatch: stage {stage} / {key}')
        for wafer, old in reference.get('by_wafer_site', {}).get(stage, {}).items():
            group = detail['scenarios']['complete']['by_wafer_site'][wafer]
            for expected_metrics, current in [(old['metrics'], group['all']['primary'])] + [
                    (metrics, group['sites'][site]['primary']) for site, metrics in old['sites'].items()]:
                for key, value in expected_metrics.items():
                    new_key = {'n': 'predicted_count', 'baseline_mae': 'train_mean_mae_same_rows'}.get(key, key)
                    if not np.isclose(current[new_key], value, rtol=1e-8, atol=1e-10):
                        raise AssertionError(f'Grouped baseline mismatch: {stage}/{wafer}/{key}')
    return differences


def evaluate(args):
    output = output_directory(args.output)
    data, flows = Path(args.data), Path(args.flows)
    inputs = sorted(data.glob('*_RawResult.csv')) + sorted(flows.glob('*.flow'))
    inputs += [Path(args.runtime), Path(args.manifest)] + [Path(p) for p in args.reference]
    inputs += [Path('grp6_app/build_models.py'), Path('grp6_app/runtime.py'), Path('grp6_app/data.py')]
    before = {p.as_posix(): sha256(p) for p in inputs}
    names, rows, matrix = load_matrix(data)
    if not rows or matrix.ndim != 2:
        raise ValueError('Empty dataset')
    scopes = [(r['Lot'], r['Wafer'], r['PID'], r['Site']) for r in rows]
    if len(set(scopes)) != len(scopes):
        raise ValueError('Duplicate lot/wafer/PID/site; attempts cannot be inferred')
    manifest = flow_manifest(flows, names)
    recorded_manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    if json.loads(json.dumps(manifest)) != recorded_manifest:
        raise AssertionError('TP flow manifest differs from frozen baseline')
    groups = np.array([int(r['Wafer']) for r in rows])
    sites = np.array([r['Site'] for r in rows])
    primary_runtime = RuntimeModels(args.runtime)
    stages, fold_artifacts, full_models, checks, csv_rows = {}, {}, {}, {}, []
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'predictions.csv.gz').open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as zipped:
            with io.TextIOWrapper(zipped, encoding='utf-8', newline='') as handle:
                writer = csv.writer(handle)
                writer.writerow(['lot', 'wafer', 'device_pid', 'site', 'stage', 'fold', 'scenario',
                                 'actual', 'primary', 'sparse8', 'fallback', 'primary_coverage',
                                 'sparse8_coverage', 'fallback_source'])
                for stage, target in TARGETS.items():
                    fs = manifest['stages'][stage]
                    indices = [names.index(n) for n in fs]
                    if any(n in TARGETS.values() or '.sensor' in n for n in fs):
                        raise AssertionError('Sensor target in causal features')
                    y = matrix[:, names.index(target)]
                    valid = np.isfinite(y)
                    if valid.sum() < 10:
                        raise ValueError('Insufficient target data')
                    full_primary, full_sparse = fit_pair(matrix[valid][:, indices], y[valid], fs)
                    frozen = primary_runtime.models[str(stage)]
                    if full_primary['features'] != frozen['features']:
                        raise AssertionError('Frozen model selection differs')
                    for key in ('median', 'mean', 'scale', 'coef', 'intercept'):
                        if not np.allclose(full_primary[key], frozen[key], rtol=1e-8, atol=1e-10):
                            raise AssertionError('Frozen model parameters differ: ' + key)
                    full_models[str(stage)] = full_sparse
                    fold_artifacts[str(stage)] = []
                    means = np.full(len(y), np.nan)
                    historical = np.full(len(y), np.nan)
                    folds = []
                    for fold in range(5):
                        train, test = valid & (groups % 5 != fold), valid & (groups % 5 == fold)
                        if not train.any() or not test.any():
                            raise ValueError('Empty train/test fold')
                        baseline, sparse = fit_pair(matrix[train][:, indices], y[train], fs)
                        means[test] = y[train].mean()
                        historical[test] = infer_matrix(baseline, matrix[test], names)
                        artifact = {'fold': fold, 'train_wafers': sorted(set(groups[train].tolist())),
                                    'test_wafers': sorted(set(groups[test].tolist())),
                                    'train_rows': int(train.sum()), 'test_rows': int(test.sum()),
                                    'primary': baseline, 'sparse8': sparse}
                        fold_artifacts[str(stage)].append(artifact)
                        folds.append((test, baseline, sparse))
                    error = historical[valid] - y[valid]
                    detail = {'eligible_features': len(fs), 'selected_primary': len(full_primary['features']),
                              'selected_sparse8': len(full_sparse['features']),
                              'historical_baseline_reproduction': {
                                  'n': int(valid.sum()), 'mae': float(np.mean(abs(error))),
                                  'rmse': float(np.sqrt(np.mean(error ** 2))),
                                  'worst_error': float(np.max(abs(error))),
                                  'baseline_mae': float(np.mean(abs(means[valid] - y[valid])))},
                              'scenarios': {}, 'latency': {}}
                    future = [i for i, n in enumerate(names) if n not in fs]
                    invariance, scalar_parity = True, True
                    for scenario in SCENARIOS:
                        stress = scenario_matrix(matrix, names, set(fs), scenario, stage)
                        preds = {p: np.full(len(y), np.nan) for p in POLICIES}
                        coverage = {p: np.zeros(len(y)) for p in POLICIES}
                        for test, baseline, sparse in folds:
                            for policy, model in [('primary', baseline), ('sparse8', sparse)]:
                                pred, cov = strict_matrix(model, stress[test], names)
                                preds[policy][test], coverage[policy][test] = pred, cov
                                # Poison every disallowed column, including targets; outputs must not move.
                                poisoned = stress[test].copy()
                                poisoned[:, future] = 1e100
                                other, other_cov = strict_matrix(model, poisoned, names)
                                invariance &= np.array_equal(pred, other, equal_nan=True) and np.array_equal(cov, other_cov)
                                for local_i in range(min(8, int(test.sum()))):
                                    values = {n: float(stress[test][local_i, names.index(n)]) for n in model['features']}
                                    scalar, scalar_cov = strict_predict(model, values)
                                    scalar_parity &= scalar_cov == cov[local_i] and (
                                        (scalar is None and np.isnan(pred[local_i])) or
                                        (scalar is not None and np.isclose(scalar, pred[local_i], rtol=1e-10, atol=1e-10)))
                        use_primary = np.isfinite(preds['primary'])
                        preds['fallback'] = np.where(use_primary, preds['primary'], preds['sparse8'])
                        coverage['fallback'] = np.where(use_primary, coverage['primary'], coverage['sparse8'])
                        report = {'all': summarize(y, preds, means, coverage, valid), 'by_site': {}, 'by_wafer_site': {}}
                        for site in sorted(set(sites)):
                            report['by_site'][site] = summarize(y, preds, means, coverage, valid & (sites == site))
                        for wafer in sorted(set(groups.tolist())):
                            mask = valid & (groups == wafer)
                            report['by_wafer_site'][str(wafer)] = {
                                'fold': wafer % 5, 'all': summarize(y, preds, means, coverage, mask),
                                'sites': {site: summarize(y, preds, means, coverage, mask & (sites == site))
                                          for site in sorted(set(sites[mask]))}}
                        detail['scenarios'][scenario] = report
                        relevant = set(full_primary['features']) | set(full_sparse['features'])
                        sample_indices = np.linspace(0, len(rows) - 1, min(64, len(rows)), dtype=int)
                        snapshots = [{n: float(stress[i, names.index(n)]) for n in relevant}
                                     for i in sample_indices]
                        detail['latency'][scenario] = latency(primary_runtime, full_sparse, stage, snapshots)
                        for policy in POLICIES:
                            csv_rows.append({'stage': stage, 'scenario': scenario, 'policy': policy, **report['all'][policy]})
                        for i, scope in enumerate(scopes):
                            if not valid[i]:
                                continue
                            source = 'primary' if use_primary[i] else 'sparse8' if np.isfinite(preds['sparse8'][i]) else 'unavailable'
                            writer.writerow([*scope, stage, int(groups[i] % 5), scenario, float(y[i]),
                                             *[float(preds[p][i]) if np.isfinite(preds[p][i]) else '' for p in POLICIES],
                                             float(coverage['primary'][i]), float(coverage['sparse8'][i]), source])
                    checks[str(stage)] = {'future_feature_invariance': bool(invariance),
                                          'scalar_matrix_parity': bool(scalar_parity),
                                          'frozen_primary_refit_matches': True,
                                          'empty_abstains': all(detail['scenarios']['empty']['all'][p]['predicted_count'] == 0 for p in POLICIES)}
                    if not all(checks[str(stage)].values()):
                        raise AssertionError('Acceptance check failed: ' + str(checks[str(stage)]))
                    stages[str(stage)] = detail
                    clean = detail['scenarios']['complete']['all']
                    missing = detail['scenarios']['missing_random_10pct']['all']
                    print(f"stage {stage}: primary MAE={clean['primary']['mae']:.9f}; sparse8 MAE={clean['sparse8']['mae']:.9f}; missing coverage={missing['primary']['prediction_coverage']:.3f}->{missing['fallback']['prediction_coverage']:.3f}", flush=True)
    references = {str(p): validate_reference(stages, json.loads(Path(p).read_text(encoding='utf-8')))
                  for p in args.reference}
    after = {p.as_posix(): sha256(p) for p in inputs}
    if before != after:
        raise AssertionError('Read-only inputs changed during evaluation')
    write_json(output / 'metrics.json', {'mode': 'offline_wafer_grouped_5_fold',
               'units': 'CSV numeric units; physical units/scaling unverified', 'devices': len(rows),
               'wafers': sorted(set(groups.tolist())), 'candidate': 'sparse8 alpha=10; primary-first fallback',
               'split': 'wafer number modulo 5; all fitting inside training folds',
               'missingness': 'synthetic 10% MCAR, latest eligible nested flow absent, and empty; not observed machine rates',
               'latency_scope': 'local scalar inference only; 64 evenly spaced devices x 5 repeats after warmup; full-fit models; excludes feature ingestion, waits, SDK and callbacks',
               'limitations': ['Reuses 25 already inspected wafers; no independent untouched holdout.',
                               'Eight features and alpha=10 fixed before evaluation; no tuning search.',
                               'Abstentions excluded from error metrics; coverage and paired-row comparisons reported separately.',
                               'CSV identity is lot/wafer/PID/site; live run/tester/head/attempt isolation not validated.',
                               'No deployment, TP deadline, delayed-data recovery or physical-unit acceptance.'],
               'stages': stages})
    write_json(output / 'candidate.json', {'proposal_only': True, 'version': 1, 'max_features': 8,
               'alpha': 10, 'requires_all_selected_inputs': True, 'models': full_models,
               'fit_scope': 'all 25 wafers; not used for held-out error metrics', 'columns': names})
    write_json(output / 'fold_models.json', fold_artifacts)
    write_json(output / 'checks.json', {'stages': checks, 'references_absolute_deltas': references,
               'input_hashes_unchanged': True, 'flow_manifest_matches': True, 'unique_offline_scopes': len(scopes)})
    with (output / 'summary.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(csv_rows[0]))
        writer.writeheader()
        writer.writerows(csv_rows)
    root = Path(__file__).resolve().parents[2]
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip()
    provenance = {'base_sha': BASE, 'source_revision_at_run': revision, 'branch': branch,
                  'python': platform.python_version(), 'numpy': np.__version__, 'platform': platform.platform(),
                  'arguments': vars(args), 'random_seed': SEED, 'input_sha256': before,
                  'data_aggregate_sha256': hashlib.sha256(json.dumps(
                      {p.name: before[p.as_posix()] for p in sorted(data.glob('*_RawResult.csv'))},
                      sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                  'evaluator_sha256': {p.name: sha256(p) for p in [Path(__file__), Path(__file__).with_name('candidate.py')]},
                  'output_sha256': {p.name: sha256(p) for p in sorted(output.iterdir())
                                    if p.name in {'metrics.json', 'candidate.json', 'fold_models.json',
                                                  'predictions.csv.gz', 'summary.csv', 'checks.json'}}}
    write_json(output / 'provenance.json', provenance)
    print('PASS: six-stage reference reproduction, causal invariance, strict missing guards, frozen model parity, read-only input hashes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True)
    parser.add_argument('--flows', required=True)
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--reference', action='append', required=True)
    parser.add_argument('--output', required=True)
    evaluate(parser.parse_args())
