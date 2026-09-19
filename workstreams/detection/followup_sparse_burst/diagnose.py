"""Offline robust-burst diagnosis. Defaults: repository training/Data and runtime
artifact; reference C:/Users/USER/Desktop/message.txt. Writes only into this fresh
follow-up folder, refuses existing output. --output names a JSON diagnostic, with
an adjacent .calibration.json. No network, labels at runtime, or Git mutation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np
from grp6_app.build_models import load_matrix
from workstreams.detection.pooled_candidate import family_of
from workstreams.detection.profile_detector import digest, value_digest

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def output_path(value):
    path = Path(value).resolve()
    owned = (ROOT / 'workstreams/detection').resolve()
    if owned not in HERE.resolve().parents or HERE.resolve() not in path.parents or path.suffix != '.json':
        raise ValueError('Output must be JSON inside detection/followup_sparse_burst')
    return path


def write_new(path, value):
    path = output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as f:
        f.write(json.dumps(value, indent=2, allow_nan=False) + '\n')


def inputs():
    artifact_path = ROOT / 'grp6_app/artifacts/runtime.json'
    artifact = json.loads(artifact_path.read_text())
    names, rows, x = load_matrix(ROOT / 'source_review/training/Data')
    families = {}
    for j, name in enumerate(names):
        family = family_of(name)
        if family.startswith('Main.subflow'):
            families.setdefault(family, []).append(j)
    return artifact, names, rows, x, families


def fit(artifact, names, rows, x, families):
    normal = artifact['detector_calibration']['normal_fit_wafers']
    wafers = np.array([int(r['Wafer']) for r in rows])
    sites = np.array([r['Site'] for r in rows])
    layout = sorted(set(sites[np.isin(wafers, normal)]))
    selected = [j for js in families.values() for j in js]
    by_site = {}
    for site in layout:
        data = x[(sites == site) & np.isin(wafers, normal)]
        if not np.isfinite(data[:, selected]).all():
            raise ValueError('Nonfinite calibration input')
        median = np.median(data, axis=0)
        mad = np.median(np.abs(data-median), axis=0)
        std = np.std(data, axis=0)
        iqr = np.quantile(data, .75, axis=0)-np.quantile(data, .25, axis=0)
        by_site[site] = {}
        for j in selected:
            fallback = max(float(iqr[j]/1.349), float(std[j]), abs(float(median[j]))*1e-9, 1e-12)
            by_site[site][names[j]] = {'median': float(median[j]), 'mad': float(mad[j]),
                'scale': float(1.4826*mad[j]) if mad[j] > 0 else fallback,
                'raw_mad_scale': float(mad[j]) if mad[j] > 0 else fallback,
                'fallback_used': bool(mad[j] == 0), 'fit_observations': len(data)}
    return {'normal_fit_wafers': normal, 'sites': layout,
            'families': {f: [names[j] for j in js] for f, js in families.items()},
            'by_site': by_site, 'scale_convention': '1.4826*MAD; MAD0 fallback max(IQR/1.349, populationSD, abs(median)*1e-9,1e-12)',
            'z_threshold': 20., 'minimum_extreme_tests': 4}


def run(output):
    artifact, names, rows, x, families = inputs()
    calibration = fit(artifact, names, rows, x, families)
    files = sorted((ROOT / 'source_review/training/Data').glob('*_RawResult.csv'))
    source = [ROOT / 'grp6_app/artifacts/runtime.json', ROOT / 'grp6_app/build_models.py',
              ROOT / 'workstreams/detection/profile_detector.py', Path(__file__)]
    hashes = {p.relative_to(ROOT).as_posix(): digest(p) for p in files+source}
    report = {'observed_head': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'reference_note_sha256': digest('C:/Users/USER/Desktop/message.txt'),
        'inputs_sha256': hashes, 'families': {f: len(js) for f,js in families.items()},
        'finite_cells': int(np.isfinite(x).sum()), 'all_cells': int(x.size),
        'normal_grid': [], 'wafers': [],
        'fallback_site_tests': sum(b['fallback_used'] for ts in calibration['by_site'].values() for b in ts.values())}
    index = {name: j for j,name in enumerate(names)}
    for w in range(1,26):
        ids = [i for i,r in enumerate(rows) if int(r['Wafer']) == w]
        entry = {'wafer': w, 'devices': len(ids), 'conventions': {}}
        for convention in ('scale','raw_mad_scale'):
            events = []
            zrows = []
            for completed, i in enumerate(ids, 1):
                site = rows[i]['Site']
                z = np.zeros(len(names))
                for name,b in calibration['by_site'][site].items():
                    j = index[name]
                    z[j] = abs(x[i,j]-b['median']) / b[convention]
                zrows.append(z)
                for family,js in families.items():
                    hits = [j for j in js if z[j] >20]
                    if len(hits)>=4:
                        events.append({'completed_devices': completed, 'pid': rows[i]['PID'], 'site':site,
                            'family':family, 'extreme_tests':len(hits),
                            'evidence':[{'test':names[j], 'raw':float(x[i,j]),
                                'median':calibration['by_site'][site][names[j]]['median'],
                                'mad':calibration['by_site'][site][names[j]]['mad'],
                                'scale':calibration['by_site'][site][names[j]][convention], 'abs_robust_z':float(z[j])} for j in hits]})
            entry['conventions'][convention] = {'events':events,
                'counts':{f:{'early40':sum(e['family']==f and e['completed_devices']<=40 for e in events),
                             'late40':sum(e['family']==f and e['completed_devices']>40 for e in events)} for f in families}}
            if w in calibration['normal_fit_wafers'] and convention=='scale':
                zrows=np.array(zrows)
                for threshold in (10,15,20,30,40):
                    for minimum in (3,4,5,6):
                        report['normal_grid'].append({'wafer':w,'z':threshold,'minimum_tests':minimum,
                            'burst_devices_by_family':{f:int(((zrows[:,js]>threshold).sum(axis=1)>=minimum).sum()) for f,js in families.items()}})
        report['wafers'].append(entry)
        print('W%02d'%w, entry['conventions']['scale']['counts'],flush=True)
    calibration['inputs_sha256']=hashes
    calibration['calibration_sha256']=value_digest(calibration)
    write_new(output.with_name(output.stem+'.calibration.json'),calibration)
    write_new(output,report)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default=str(HERE/'diagnostic.json'))
    output=output_path(parser.parse_args().output)
    if output.exists() or output.with_name(output.stem+'.calibration.json').exists():
        raise ValueError('Refusing overwrite')
    run(output)
