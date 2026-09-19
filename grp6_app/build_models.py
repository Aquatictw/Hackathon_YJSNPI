"""Build verified flow allowlists, wafer-held-out metrics and portable models."""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
import numpy as np
from .data import TARGETS


def load_matrix(data_dir):
    header = None
    records, values = [], []
    for path in sorted(Path(data_dir).glob('*_RawResult.csv')):
        with path.open(encoding='utf-8-sig', newline='') as handle:
            rows = csv.reader(handle)
            names = next(rows)
            if header is None:
                header = names[10:]
            if names[10:] != header:
                raise ValueError('CSV columns differ: ' + str(path))
            for _ in range(4):
                next(rows)
            for row in rows:
                if not row or not row[0].isdigit():
                    continue
                if len(row) != len(names):
                    raise ValueError('Incomplete row: ' + str(path))
                records.append(dict(zip(names[:10], row[:10])))
                values.append([float(v) if v.strip() else np.nan for v in row[10:]])
    matrix = np.asarray(values, dtype=float)
    matrix[~np.isfinite(matrix)] = np.nan
    return header, records, matrix


def flow_manifest(flow_dir, names):
    root = Path(flow_dir)
    sources = {}
    def walk(filename, prefix, stack=()):
        if filename in stack:
            raise ValueError('Recursive flow')
        path = root / (filename + '.flow')
        raw = path.read_text(encoding='utf-8-sig')
        sources[path.name] = hashlib.sha256(raw.encode()).hexdigest()
        text = re.sub(r'/\*.*?\*/|//[^\n]*', '', raw, flags=re.S)
        setup, body = re.split(r'\bexecute\s*\{', text, maxsplit=1)
        children = dict(re.findall(r'\bflow\s+(\w+)\s+calls\s+\w+\.(\w+)', setup))
        for suite in re.findall(r'\b(\w+)\.execute\s*\(\s*\)\s*;', body):
            if suite in children:
                yield from walk(children[suite], prefix + '.' + suite, stack + (filename,))
            else:
                yield prefix + '.' + suite
    execution = list(walk('Main', 'Main'))
    suite_of = {name: name.split('_', 1)[1].split('#', 1)[0] for name in names}
    stages = {}
    for stage in TARGETS:
        boundary = execution.index('Main.receive_temp_predict' + str(stage))
        allowed = set(execution[:boundary])
        stages[stage] = [name for name in names if suite_of[name] in allowed
                         and '.sensor' not in suite_of[name] and '#' in name]
    return {'sources_sha256': sources, 'execution': execution, 'stages': stages,
            'excluded_unexecuted_columns': [n for n in names if suite_of[n] not in execution]}


def fit_linear(x, y, names, max_features=32, alpha=10.):
    med = np.nanmedian(x, axis=0)
    med = np.where(np.isfinite(med), med, 0.)
    x = np.where(np.isfinite(x), x, med)
    mean, scale = x.mean(0), np.maximum(x.std(0), 1e-9)
    z = (x - mean) / scale
    selected = np.argsort(np.abs(z.T @ (y-y.mean())))[-min(max_features, len(names)):]
    z = z[:, selected]
    coef = np.linalg.solve(z.T @ z + alpha*np.eye(len(selected)), z.T @ (y-y.mean()))
    return {'features': [names[i] for i in selected], 'median': med[selected].tolist(),
            'mean': mean[selected].tolist(), 'scale': scale[selected].tolist(),
            'coef': coef.tolist(), 'intercept': float(y.mean())}


def infer_matrix(model, matrix, names):
    x = matrix[:, [names.index(n) for n in model['features']]]
    x = np.where(np.isfinite(x), x, model['median'])
    return model['intercept'] + ((x-model['mean'])/model['scale']) @ model['coef']


def metrics(y, pred, baseline):
    error = pred-y
    return {'n': len(y), 'mae': float(np.mean(abs(error))),
            'rmse': float(np.sqrt(np.mean(error**2))), 'worst_error': float(max(abs(error))),
            'baseline_mae': float(np.mean(abs(baseline-y)))}


def build(source, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    names, rows, x = load_matrix(Path(source)/'training/Data')
    manifest = flow_manifest(Path(source)/'SmarTest/Case_Smt870/src/TestCase1', names)
    groups = np.array([int(row['Wafer']) for row in rows])
    models, evaluation, grouped, folds = {}, {}, {}, {}
    sites = np.array([row['Site'] for row in rows])
    for stage, target in TARGETS.items():
        fs = manifest['stages'][stage]
        idx = [names.index(n) for n in fs]
        y = x[:, names.index(target)]
        valid = np.isfinite(y)
        prediction, baseline = np.full(len(y), np.nan), np.full(len(y), np.nan)
        for fold in range(5):
            train = valid & (groups % 5 != fold)
            test = valid & (groups % 5 == fold)
            model = fit_linear(x[train][:, idx], y[train], fs)
            prediction[test] = infer_matrix(model, x[test], names)
            baseline[test] = np.mean(y[train])
        evaluation[stage] = metrics(y[valid], prediction[valid], baseline[valid])
        grouped[stage] = {}
        for wafer in sorted(set(groups.tolist())):
            wafer_mask = valid & (groups == wafer)
            grouped[stage][str(wafer)] = {
                'fold': wafer % 5,
                'metrics': metrics(y[wafer_mask], prediction[wafer_mask], baseline[wafer_mask]),
                'sites': {str(site): metrics(y[mask], prediction[mask], baseline[mask])
                          for site in sorted(set(sites[wafer_mask]))
                          for mask in [wafer_mask & (sites == site)]}}
        folds[stage] = [{
            'fold': fold, 'train_wafers': sorted(set(groups[valid & (groups % 5 != fold)].tolist())),
            'test_wafers': sorted(set(groups[valid & (groups % 5 == fold)].tolist()))}
            for fold in range(5)]
        models[stage] = fit_linear(x[valid][:,idx], y[valid], fs)
        print('stage', stage, 'allowlist', len(fs), evaluation[stage], flush=True)
    normal_wafers = [2,4,5,6,7,8,10,11,12,13,15,16,17,19,20,21,22,24]
    normal = np.isin(groups, normal_wafers)
    med, sd = np.nanmedian(x[normal], axis=0), np.nanstd(x[normal], axis=0)
    baseline_tests = {name: {'mean': float(med[i]), 'sd': float(max(sd[i], 1e-9))}
                      for i,name in enumerate(names) if '#' in name and np.isfinite(med[i])}
    artifacts = {'version': 1, 'models': models, 'baselines': baseline_tests,
                 'baseline_wafers': normal_wafers, 'columns': names,
                 'site_ids': sorted(set(r['Site'] for r in rows))}
    (output/'runtime.json').write_text(json.dumps(artifacts, allow_nan=False), encoding='utf-8')
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    detail = {'mode': 'wafer_grouped_5_fold', 'split': 'wafer number modulo 5',
              'feature_selection': 'within each training fold', 'devices': len(rows),
              'wafers': sorted(set(groups.tolist())), 'metrics': evaluation,
              'by_wafer_site': grouped, 'folds': folds,
              'units': 'CSV numeric units; sensor physical units require live confirmation'}
    (output/'validation.json').write_text(json.dumps(detail, indent=2), encoding='utf-8')
    print('devices', len(rows), 'measurements', x.shape, 'artifacts', output, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('--output', default='grp6_app/artifacts')
    args = parser.parse_args()
    build(args.source, args.output)
