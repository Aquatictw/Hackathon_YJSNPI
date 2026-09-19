"""Supplementary claim checks from immutable W25 and saved B follow-up scans.
No tuning/selection: threshold dominance and stratified event-count arithmetic.
Default inputs/outputs stay in this follow-up folder.
"""
import argparse
import json
import math
import numpy as np
from workstreams.prediction.spread_audit import blob, parse_export, temporal_dispersion, digest
from workstreams.prediction.followup_burst_20260919.audit_bursts import HERE, SITES, output_path, dump, alerts

def stratified_tail(early_counts, late_counts, early_n, late_n):
    """Convolve four conditional site-wise hypergeometric distributions."""
    distribution=np.array([1.])
    for a,b,ne,nl in zip(early_counts,late_counts,early_n,late_n):
        total=a+b
        d=np.zeros(total+1)
        for k in range(max(0,total-nl),min(ne,total)+1):
            d[k]=math.comb(ne,k)*math.comb(nl,total-k)/math.comb(ne+nl,total)
        distribution=np.convolve(distribution,d)
    return float(distribution[sum(early_counts):].sum())

def run(output):
    output=output_path(output); output.mkdir(parents=True,exist_ok=True)
    audit=json.loads((HERE/'audit.json').read_text())
    raw=blob('source_review/training/Data/A12345_W25_RawResult.csv')
    names,meta,x,quality=parse_export(raw); sites=np.array([m['Site'] for m in meta])
    artifact=json.loads(blob('grp6_app/artifacts/runtime.json'))
    floor=np.array([max(artifact['baselines'].get(n,{}).get('sd',1e-8)*.1,1e-12) for n in names])
    js=[i for i,n in enumerate(names) if n in artifact['baselines'] and n.split('_',1)[1].rsplit('.',1)[0]=='Main.subflow1']
    baseline_scores=[]
    for n in range(32,81,8):
        temporal=temporal_dispersion(x,sites,n,floor)
        down=-np.mean([np.log(temporal[s][2]) for s in SITES],axis=0)
        q=float(np.quantile(down[js],.8))
        gate=artifact['family_thresholds']['Main.subflow1'][3]
        baseline_scores.append({'n':n,'family_q80_mean_site_log_drop':q,'threshold':gate,'normalized':q/gate})
    events=audit['claim_comparison']['normal_fit_scaled_MAD']['Main.subflow1']['burst_devices']
    stratified=[]
    for n in range(32,81,8):
        h=n//2; a=[]; b=[]; ne=[]; nl=[]
        for site in SITES:
            a.append(sum(d<=h and sites[d-1]==site for d in events))
            b.append(sum(h<d<=n and sites[d-1]==site for d in events))
            ne.append(int(np.sum(sites[:h]==site))); nl.append(int(np.sum(sites[h:n]==site)))
        stratified.append({'n':n,'early_site_counts':a,'late_site_counts':b,'early_site_n':ne,'late_site_n':nl,
                           'one_sided_conditional_site_p':stratified_tail(a,b,ne,nl)})
    def family_rows(w): return [r for r in audit['all_scans'][str(w)] if r['family']=='Main.subflow1']
    w25=family_rows(25); w15=family_rows(15)
    # With two adjacent passes, each pair's weaker score controls detection.
    def best_pair(rows):
        choices=[{'ending_n':b['n'],'weaker_score':min(a['score'],b['score'])}
                 for a,b in zip(rows,rows[1:]) if a['eligible'] and b['eligible']]
        return max(choices,key=lambda r:r['weaker_score'])
    pair25,pair15=best_pair(w25),best_pair(w15)
    gate=audit['normal_max_score']+1e-12
    envelope_only={str(w):alerts(rows,gate) for w,rows in audit['all_scans'].items() if alerts(rows,gate)}
    minima={}
    for label,rows in [('full_fit', {str(w):audit['all_scans'][str(w)] for w in audit['reference_wafers']}),
                       ('leave_one_normal_out',audit['normal_loo_scans'])]:
        maxima=max((dict(row,wafer=int(w)) for w,scan in rows.items() for row in scan),key=lambda r:r['score'])
        minima[label]=maxima
    result={'source_sha256':digest(__import__('pathlib').Path(__file__).read_bytes()),
        'audit_sha256':digest((HERE/'audit.json').read_bytes()),'w25_csv_sha256':digest(raw),
        'baseline_note_claim':{'claimed_rounded_score':.186,'claimed_rounded_threshold':.358,'independent_scores':baseline_scores},
        'w25_site_stratified_tables':stratified,'normal_calibration_maxima':minima,
        'threshold_dominance':{'w25_best_pair':pair25,'normal_w15_best_pair':pair15,
            'w15_dominates_w25':pair15['weaker_score']>=pair25['weaker_score'],
            'scope':'For this fixed z20/min4/min4-early/equal-half score, any common monotone threshold admitting W25 with two votes also admits W15.'},
        'postdeclared_remove_nominal_floor':{'gate':gate,'research_additions':envelope_only,
            'label':'Diagnostic counterfactual after seeing results; not a selected replacement or acceptance.'},
        'limits':['Site conditioning does not remove mean-return or within-site temporal correlation confounds.',
                  'These computations test the note and B audit rule, not every possible C burst method.']}
    dump(output/'claim-checks.json',result)
    print(json.dumps(result,indent=2))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--output',default=str(HERE))
    run(parser.parse_args().output)
