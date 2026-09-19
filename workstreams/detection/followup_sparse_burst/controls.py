"""Seeded mechanism and specificity controls; failures are scientific outcomes."""
import argparse
import random
import time
from .candidate import CONFIG, SparseBurstDetector
from .diagnose import HERE, output_path, write_new
from workstreams.detection.profile_detector import value_digest, digest


def calibration(families=6, tests=20):
    fs={f'family{i}':[f'f{i}_test{j}' for j in range(tests)] for i in range(families)}
    c={'sites':['1','2','3','4'],'families':fs,'config':CONFIG.copy(),
       'empirical_p_cutoff':1.0,'by_site':{str(s):{t:{'median':0.,'mad':1/1.4826,'scale':1.}
       for ts in fs.values() for t in ts} for s in range(1,5)}}
    c['calibration_sha256']=value_digest(c)
    return c


CASES=('strong_sparse_decline','stationary_regular_bursts','burst_rate_increase',
       'one_extreme_test','one_impulse','permanent_mean_step_up',
       'constant_noise_mean_step_down','transient_mean_excursion',
       'site_specific_constant_offset','stationary_iid_bursts')


def stream(case, seed, n=80, c=None):
    c=c or calibration(); rng=random.Random(seed)
    for i in range(1,n+1):
        site=str((i-1)%4+1)
        values={t:rng.gauss(0,1) for ts in c['families'].values() for t in ts}
        active=False; count=4
        if case=='strong_sparse_decline': active=i<=24
        elif case=='stationary_regular_bursts': active=i%4==0
        elif case=='burst_rate_increase': active=i>40
        elif case=='one_extreme_test': active=i<=24; count=1
        elif case=='one_impulse': active=i==8
        elif case=='permanent_mean_step_up': active=i>24
        elif case=='constant_noise_mean_step_down': active=i<=24
        elif case=='transient_mean_excursion': active=9<=i<=32
        elif case=='site_specific_constant_offset': active=site=='1'
        elif case=='stationary_iid_bursts':
            for ts in c['families'].values():
                if rng.random()<.1:
                    for t in ts[:4]: values[t]+=30
        else: raise ValueError(case)
        if active:
            for t in next(iter(c['families'].values()))[:count]: values[t]+=30
        yield site,values


def run_case(case, seed, c=None):
    c=c or calibration(); d=SparseBurstDetector(c); alerts=[]; scans=[]
    for site,values in stream(case,seed,c=c):
        d.add(site,values); alerts.extend(d.analyze()); scans.extend(d.latest_scans)
    return {'case':case,'seed':seed,'alerts':alerts,'scans':scans,
            'first_detection':min((a['completed_devices'] for a in alerts),default=None)}


def run(output):
    start=time.perf_counter(); c=calibration()
    results=[run_case(case,seed,c) for case in CASES for seed in range(20)]
    null=[run_case('stationary_iid_bursts',seed,c) for seed in range(1000,1100)]
    summary={case:{'n':20,'alerted':sum(bool(r['alerts']) for r in results if r['case']==case),
             'first_devices':sorted({r['first_detection'] for r in results if r['case']==case and r['alerts']})}
             for case in CASES}
    write_new(output,{'scope':'Synthetic development controls; no estimate of real wafer false-positive rate',
        'source_sha256':{'controls.py':digest(__file__),'candidate.py':digest(HERE/'candidate.py')},
        'synthetic_calibration':c,'summary':summary,'cases':results,
        'additional_iid_null':{'n':100,'alerted':sum(bool(r['alerts']) for r in null),'cases':null},
        'limits':['Noise variance is 1 in every Gaussian case, including detected mean-step-down/excursion controls.',
                  'Strong sparse-decline and constant-noise mean-step-down use identical observations: mechanism is not identifiable from a burst indicator.',
                  'Fixed synthetic location/scale are an oracle, not a fit to real data; real calibration is evaluated separately.',
                  'IID null controls do not establish exchangeability for correlated site/test/time data.'],
        'wall_seconds':time.perf_counter()-start})
    print(summary,flush=True)
    print('Additional IID null alerts',sum(bool(r['alerts']) for r in null),'/100',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default=str(HERE/'controls.json'))
    run(output_path(parser.parse_args().output))
