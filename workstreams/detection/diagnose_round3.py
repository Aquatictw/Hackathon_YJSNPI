"""R3 absolute-variance exploration, not a detection decision.
Defaults: source_review/training/Data and grp6_app/artifacts/runtime.json;
output round3/absolute-variance.json. Refuses overwrite or output outside round3.
Original round3/exploration.json is retained as the initial exploratory snapshot.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from grp6_app.build_models import load_matrix
from .evaluate_round3 import output_path

ROOT = Path(__file__).resolve().parents[2]

def run(output):
    artifact = json.loads((ROOT / 'grp6_app/artifacts/runtime.json').read_text())
    names, rows, x = load_matrix(ROOT / 'source_review/training/Data')
    wafers = np.array([int(r['Wafer']) for r in rows])
    sites = np.array([r['Site'] for r in rows])
    normal = artifact['detector_calibration']['normal_fit_wafers']
    families = {}
    for j, name in enumerate(names):
        if name in artifact['baselines']:
            families.setdefault(name.split('_', 1)[1].rsplit('.', 1)[0], []).append(j)
    families = {f: js for f, js in families.items() if len(js) >= 20}
    report = []
    for count in range(32, 81, 8):
        variance = {}
        for w in range(1, 26):
            data, ss = x[wafers == w][:count], sites[wafers == w][:count]
            variance[w] = np.array([np.var(data[ss == s], axis=0, ddof=1) for s in sorted(set(ss))])
        ref = np.median([variance[w] for w in normal], axis=0)
        for w in range(1, 26):
            for f, js in families.items():
                ratios = variance[w][:, js] / np.maximum(ref[:, js], 1e-24)
                report.append({'wafer': w, 'count': count, 'family': f,
                    'median_variance_ratio': float(np.median(ratios)),
                    'mean_variance_ratio': float(np.mean(ratios)),
                    'site_median_variance_ratios': np.median(ratios, axis=1).tolist(),
                    'site_mean_variance_ratios': np.mean(ratios, axis=1).tolist()})
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as handle:
        handle.write(json.dumps(report, indent=2, allow_nan=False) + '\n')
    for f in families:
        print(f)
        for count in [32, 48, 64, 80]:
            selected = [r for r in report if r['family'] == f and r['count'] == count]
            ordered = sorted(selected, key=lambda r: r['median_variance_ratio'])
            print(count, [(r['wafer'], round(r['median_variance_ratio'], 4), round(r['mean_variance_ratio'],4)) for r in ordered[:5]])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(ROOT / 'workstreams/detection/round3/absolute-variance.json'))
    output = output_path(parser.parse_args().output)
    if output.exists():
        raise ValueError('Refusing to overwrite exploratory evidence')
    run(output)
