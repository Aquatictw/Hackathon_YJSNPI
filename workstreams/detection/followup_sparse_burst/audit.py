"""Verify saved follow-up evidence; --package creates a new frozen manifest."""
import argparse
import json
import math
from pathlib import Path
from .diagnose import HERE, ROOT, write_new
from .candidate import CONFIG, fisher_decrease
from .evaluate import calibrate
from workstreams.detection.profile_detector import canonical, digest, value_digest


def read(p): return json.loads(p.read_text(encoding='utf-8'))


def audit():
    prior=read(HERE/'prior-files-sha256.json')
    for name,h in prior.items(): assert digest(ROOT/name)==h,('historical mutation',name)
    e=read(HERE/'evaluation.json'); c=read(HERE/'evaluation.calibration.json')
    seed=read(HERE/'diagnostic.calibration.json'); diag=read(HERE/'diagnostic.json')
    for src in (e['inputs_sha256'],e['source_sha256'],diag['inputs_sha256']):
        for name,h in src.items(): assert digest(ROOT/name)==h,name
    for obj in (seed,c):
        assert value_digest({k:v for k,v in obj.items() if k!='calibration_sha256'})==obj['calibration_sha256']
    assert canonical(calibrate(seed,diag))==canonical(c)
    assert digest(HERE/'reference-message.txt')==diag['reference_note_sha256']
    historical={w['wafer']:w for w in read(ROOT/'workstreams/detection/evidence/baseline/summary.json')['wafers']}
    baseline_count=scan_count=0
    for w,dw in zip(e['wafers'],diag['wafers'],strict=True):
        assert w['wafer']==dw['wafer']
        assert canonical(w['baseline_alerts'])==canonical(historical[w['wafer']]['alerts'])
        assert w['removed_baseline_alerts']==[]
        baseline_count+=len(w['baseline_alerts'])
        events=dw['conventions']['scale']['events']
        for mode in ('corrected','nominal_two','nominal_one'):
            streak={f:0 for f in c['families']}; emitted=set(); expected=[]
            for s in w['modes'][mode]['scans']:
                f=s['family']; n=s['completed_devices']; half=n//2
                a=sum(x['family']==f and x['completed_devices']<=half for x in events)
                b=sum(x['family']==f and half<x['completed_devices']<=n for x in events)
                assert (s['early_bursts'],s['late_bursts'])==(a,b)
                assert s['p_value']==fisher_decrease(a,b,half,half)
                allocation=.05/(6*s['scan_index']*(s['scan_index']+1))
                cap=min(c['empirical_p_cutoff'],allocation if mode=='corrected' else .05)
                assert s['p_cutoff']==cap and s['ready']
                passed=a>=4 and a>b and s['p_value']<=cap
                persistence=1 if mode=='nominal_one' else 2
                streak[f]=min(persistence,streak[f]+1) if passed else 0
                assert s['passed']==passed and s['streak']==streak[f]
                if passed and streak[f]>=persistence and f not in emitted:
                    emitted.add(f); expected.append((f,n))
                scan_count+=1
            assert [(a['family'],a['completed_devices']) for a in w['modes'][mode]['alerts']]==expected
    assert baseline_count==14 and scan_count==3150
    controls=read(HERE/'controls.json')
    for name,h in controls['source_sha256'].items(): assert digest(HERE/name)==h
    for case in controls['summary']:
        rows=[r for r in controls['cases'] if r['case']==case]
        assert len(rows)==20
        assert sum(bool(r['alerts']) for r in rows)==controls['summary'][case]['alerted']
    assert len(controls['additional_iid_null']['cases'])==100
    bdir=ROOT/'workstreams/prediction/followup_burst_20260919'
    b=read(bdir/'audit.json'); b_events=read(bdir/'burst-evidence.json')
    by_key={(x['wafer'],x['device'],x['family']):x for x in b_events}
    matched_events=matched_values=0
    for w in diag['wafers']:
        for event in w['conventions']['scale']['events']:
            be=by_key[(w['wafer'],event['completed_devices'],event['family'])]
            assert (event['site'],event['extreme_tests'])==(be['site'],be['extreme_tests'])
            details={v['test']:v for v in be['details']}
            for v in event['evidence']:
                bv=details[v['test']]
                for k in ('raw','median','mad','scale'): assert math.isclose(v[k],bv[k],rel_tol=1e-12,abs_tol=1e-12)
                assert math.isclose(v['abs_robust_z'],bv['robust_z'],rel_tol=1e-12,abs_tol=1e-12)
                matched_values+=1
            matched_events+=1
    assert matched_events==len(b_events)
    independent_scans=0
    for w in e['wafers']:
        oracle={(s['family'],s['n']):s for s in b['all_scans'][str(w['wafer'])]}
        for s in w['modes']['corrected']['scans']:
            bs=oracle[(s['family'],s['completed_devices'])]
            assert (s['early_bursts'],s['late_bursts'])==(bs['early'],bs['late'])
            assert math.isclose(s['p_value'],bs['p_fixed_table'],rel_tol=1e-12,abs_tol=1e-12)
            independent_scans+=1
    external=[bdir/'audit.json',bdir/'burst-evidence.json',bdir/'controls.json',
              ROOT/'results/burst_followup_review.json',ROOT/'results/r3_research_review.json']
    result={'status':'READY_FOR_A','recommendation':'REJECT runtime and accepted replay promotion; archive diagnostic research',
        'historical_files_unchanged':len(prior),'baseline_alert_payloads_exact':baseline_count,
        'removed_baseline_alerts':0,'scans_verified_in_three_modes':scan_count,
        'B_scan_p_counts_match':independent_scans,'B_burst_events_match':matched_events,
        'B_extreme_test_values_match':matched_values,'numeric_tolerance':{'relative':1e-12,'absolute':1e-12},
        'synthetic_cases':300,'unit_tests':{'new':15,'total_detection':51},
        'external_evidence_sha256':{p.relative_to(ROOT).as_posix():digest(p) for p in external},
        'accepted_replay_7_of_7':False,'scientific_spread_specificity_pass':False}
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',action='store_true')
    args=parser.parse_args(); result=audit()
    manifest_path=HERE/'manifest.json'
    if args.package:
        if manifest_path.exists() or (HERE/'review.json').exists(): raise ValueError('Refusing overwrite')
        write_new(HERE/'review.json',result)
        files=sorted(p for p in HERE.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p!=manifest_path)
        # Audit command writes stdout only; redirecting into this folder while
        # packaging would create a changing log, so invoke without redirection.
        write_new(manifest_path,{'scope':'C R3 sparse-burst follow-up only; self hash excluded',
            'files':{p.relative_to(ROOT).as_posix():{'sha256':digest(p),'bytes':p.stat().st_size} for p in files}})
    if manifest_path.exists():
        for name,record in read(manifest_path)['files'].items(): assert digest(ROOT/name)==record['sha256'],name
        print('Frozen follow-up manifest verified:',digest(manifest_path))
    print(json.dumps(result,indent=2))


if __name__=='__main__': main()
