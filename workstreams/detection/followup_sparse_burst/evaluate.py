"""Offline all-wafer evaluation. New output prefix required; never overwrites."""
import argparse
from collections import deque
import copy
import json
import platform
import sys
import time
from pathlib import Path
from grp6_app.runtime import WaferDetector
from grp6_app.rehearse import EXPECTED
from workstreams.detection.profile_detector import canonical, digest, value_digest, read_wafer, timings
from .diagnose import ROOT, HERE, output_path, write_new
from .candidate import CONFIG, SparseBurstDetector


def retained(detector):
    seen=set()
    def size(v):
        if id(v) in seen: return 0
        seen.add(id(v))
        n=sys.getsizeof(v)
        if isinstance(v,dict): n+=sum(size(k)+size(x) for k,x in v.items())
        elif isinstance(v,(list,tuple,set,deque)): n+=sum(size(x) for x in v)
        return n
    state={k:v for k,v in vars(detector).items() if k not in ('baselines','families','sites','calibration_sha256')}
    return {'reachable_mutable_bytes':size(state),'window_records':sum(map(len,detector.windows.values())),
            'maximum_records_per_family':max(map(len,detector.windows.values()))}


def replay(calibration, rows, mode):
    start=time.perf_counter_ns()
    d=SparseBurstDetector(calibration,mode)
    constructor=(time.perf_counter_ns()-start)/1e6
    scans=[]; alerts=[]; samples={'add':[],'active_scan':[],'final':[]}
    for site,values,_passed in rows:
        t=time.perf_counter_ns(); d.add(site,values); u=time.perf_counter_ns()
        alerts.extend(d.analyze()); v=time.perf_counter_ns()
        samples['add'].append((u-t)/1e6)
        if d.latest_scans: samples['active_scan'].append((v-u)/1e6)
        scans.extend(d.latest_scans)
    t=time.perf_counter_ns(); final=d.analyze(final=True)
    samples['final'].append((time.perf_counter_ns()-t)/1e6)
    assert not final
    elapsed=(time.perf_counter_ns()-start)/1e6
    return {'alerts':alerts,'scans':scans,'state':retained(d),
            'timing_ms':{k:timings(v) for k,v in samples.items()},'samples_ms':samples,
            'constructor_ms':constructor,'replay_wall_ms':elapsed}


def calibrate(seed, diagnostic):
    c=copy.deepcopy(seed); c.pop('calibration_sha256')
    c['config']=CONFIG.copy(); c['empirical_p_cutoff']=1.0
    c['calibration_sha256']=value_digest(c)
    witnesses=[]
    # Same scan/count implementation; consume only normal-fit streams.
    for w in diagnostic['wafers']:
        if w['wafer'] not in c['normal_fit_wafers']: continue
        events={(e['completed_devices'],e['family']) for e in w['conventions']['scale']['events']}
        d=SparseBurstDetector(c)
        # Derived boolean records avoid recomputing identical robust z values.
        for n in range(1,w['devices']+1):
            site=c['sites'][(n-1)%len(c['sites'])]
            for f in d.families:
                d.windows[f].append({'site':site,'valid':True,'burst':(n,f) in events})
            d.completed=n; d.analyze()
            for s in d.latest_scans:
                if s['ready'] and s['early_bursts']>=CONFIG['minimum_early_bursts'] and s['early_bursts']>s['late_bursts']:
                    witnesses.append({'wafer':w['wafer'],**s})
    c.pop('calibration_sha256')
    c['empirical_p_cutoff']=min((s['p_value'] for s in witnesses),default=1.0)/CONFIG['normal_margin']
    c['cutoff_fit']={'rule':'minimum qualifying normal-fit p / 1.2; no anomaly/other-normal inputs',
                     'witnesses':witnesses,'empty_policy':'1 / margin'}
    c['calibration_sha256']=value_digest(c)
    return c


def run(output):
    started=time.perf_counter()
    seed=json.loads((HERE/'diagnostic.calibration.json').read_text())
    diagnostic=json.loads((HERE/'diagnostic.json').read_text())
    for p,h in seed['inputs_sha256'].items():
        assert digest(ROOT/p)==h,p
    c=calibrate(seed,diagnostic)
    artifact=json.loads((ROOT/'grp6_app/artifacts/runtime.json').read_text())
    oracle_path=ROOT/'workstreams/detection/evidence/baseline/summary.json'
    historical={w['wafer']:w for w in json.loads(oracle_path.read_text())['wafers']}
    result={'scope':'same-round reused-development offline research; no accepted coverage/promotion',
            'environment':{'python':sys.version,'platform':platform.platform()},
            'calibration_sha256':c['calibration_sha256'],'empirical_p_cutoff':c['empirical_p_cutoff'],
            'source_sha256':{p.relative_to(ROOT).as_posix():digest(p) for p in
                [Path(__file__),HERE/'candidate.py',HERE/'diagnostic.json',HERE/'diagnostic.calibration.json',
                 ROOT/'grp6_app/runtime.py',oracle_path]},'inputs_sha256':seed['inputs_sha256'],
            'wafers':[],'summary':{}}
    for path in sorted((ROOT/'source_review/training/Data').glob('*_RawResult.csv')):
        wafer,rows=read_wafer(path)
        assert [str(s) for s,_,_ in rows]==[c['sites'][i%len(c['sites'])] for i in range(len(rows))], 'calibration site-order assumption'
        modes={mode:replay(c,rows,mode) for mode in ('corrected','nominal_two','nominal_one')}
        core=WaferDetector(artifact['baselines'],artifact['family_thresholds']); base=[]
        for site,values,passed in rows:
            core.add(site,values,passed); base.extend(core.analyze())
        base.extend(core.analyze(final=True))
        assert canonical(base)==canonical(historical[wafer]['alerts']),wafer
        result['wafers'].append({'wafer':wafer,'expected':EXPECTED.get(wafer),'devices':len(rows),
            'baseline_alerts':base,'baseline_exact_oracle_equal':True,'removed_baseline_alerts':[],
            'modes':modes})
        print('W%02d'%wafer,{m:[(a['family'],a['completed_devices']) for a in r['alerts']] for m,r in modes.items()},flush=True)
    for mode in ('corrected','nominal_two','nominal_one'):
        alerts=[{'wafer':w['wafer'],'family':a['family'],'completed_devices':a['completed_devices']}
                for w in result['wafers'] for a in w['modes'][mode]['alerts']]
        samples={k:[x for w in result['wafers'] for x in w['modes'][mode]['samples_ms'][k]] for k in ('add','active_scan','final')}
        result['summary'][mode]={'supplementary_alerts':alerts,
            'normal_labeled_false_alerts':[a for a in alerts if a['wafer'] not in EXPECTED],
            'normal_labeled_denominator':25-len(EXPECTED),'timing_ms':{k:timings(v) for k,v in samples.items()},
            'max_mutable_state_bytes':max(w['modes'][mode]['state']['reachable_mutable_bytes'] for w in result['wafers']),
            'w25_first':next((a['completed_devices'] for a in alerts if a['wafer']==25),None)}
    result['baseline_preservation']={'exact_alerts':sum(len(w['baseline_alerts']) for w in result['wafers']),
        'all25_exact':True,'removed':0,'baseline_summary_sha256':digest(oracle_path)}
    result['evaluation_wall_seconds']=time.perf_counter()-started
    write_new(output.with_name(output.stem+'.calibration.json'),c)
    write_new(output,result)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default=str(HERE/'evaluation.json'))
    out=output_path(parser.parse_args().output)
    if out.exists() or out.with_name(out.stem+'.calibration.json').exists(): raise ValueError('Refusing overwrite')
    run(out)
