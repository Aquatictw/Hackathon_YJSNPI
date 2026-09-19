"""Independent raw-data checks and diagnostics; writes only beside this script."""
import collections, csv, hashlib, json, math, platform, sys
from pathlib import Path
import numpy as np
ROOT=Path.cwd(); OUT=ROOT/'results/replay_investigation_20260919/model'
sys.path.insert(0,str(ROOT))
from grp6_app.build_models import load_matrix, flow_manifest
from grp6_app.runtime import RuntimeModels
from grp6_app.sparse_burst import SparseBurstSpreadDown
EXPECTED={1:'site_imbalance',3:'low_yield',9:'low_yield',14:'mean_drift_up',18:'mean_drift_down',23:'spread_up',25:'spread_down'}
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def save(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2,allow_nan=False),encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def counter(xs): return dict(sorted(collections.Counter(xs).items()))
def canonical(x): return json.dumps(x,sort_keys=True,separators=(',',':'))
base=read(OUT/'baseline/summary.json'); candidate=read(OUT/'candidate/summary.json')
accepted=read(ROOT/'results/replay/summary.json')
artifact=read(OUT/'baseline_artifacts/runtime.json')
raw=[]
for path in sorted((ROOT/'source_review/training/Data').glob('*_RawResult.csv')):
    with path.open(encoding='utf-8-sig',newline='') as f: allrows=list(csv.reader(f))
    header=allrows[0]; data=allrows[5:]; w=int(path.name.split('_W')[1].split('_')[0])
    assert len(data)==80 and len(header)==3046 and all(len(row)==len(header) for row in allrows)
    records=[dict(zip(header[:10],row[:10])) for row in data]
    entry={'wafer':w,'file':path.relative_to(ROOT).as_posix(),'sha256':sha(path),'rows':len(data),'columns':len(header),
           'metadata_first_cells':[row[0] for row in allrows[1:5]],
           'counts':{k:counter(r[k] for r in records) for k in ['Lot','Wafer','Site','PF','SBin','HBin']},
           'cross_PF_SBin_HBin':counter('|'.join(r[k] for k in ['PF','SBin','HBin']) for r in records),
           'unique_PID':len(set(r['PID'] for r in records)),
           'duplicate_PID_site':len(records)-len(set((r['PID'],r['Site']) for r in records)),
           'wafer_identity_matches_filename':all(int(r['Wafer'])==w for r in records),
           'sbin_hbin_mismatches':sum(r['SBin']!=r['HBin'] for r in records),
           'sbin_PF_disagreements':sum((r['SBin']=='1')!=(r['PF']=='0') for r in records),
           'pass':sum(r['SBin']=='1' for r in records),
           'sites':{s:{'pass':sum(r['SBin']=='1' for r in records if r['Site']==s),'n':sum(r['Site']==s for r in records)} for s in sorted(set(r['Site'] for r in records))}}
    entry['yield']=entry['pass']/entry['rows']
    raw.append(entry)
    if w==2:
        with (OUT/'w02_raw_device_metadata.csv').open('w',newline='',encoding='utf-8') as f:
            writer=csv.DictWriter(f,fieldnames=header[:10]); writer.writeheader(); writer.writerows(records)
        prefix=[]
        for n in range(8,81,8):
            good=sum(r['SBin']=='1' for r in records[:n]); rate=good/n; z=1.645
            upper=(rate+z*z/(2*n)+z*math.sqrt(rate*(1-rate)/n+z*z/(4*n*n)))/(1+z*z/n)
            prefix.append({'completed':n,'pass':good,'yield':rate,'wilson_upper':upper})
        entry['prefixes']=prefix
save('raw_data_audit.json',raw)
comparisons=[]
for b,c in zip(base['wafers'],candidate['wafers']):
    w=b['wafer']; exp={EXPECTED[w]} if w in EXPECTED else set()
    entry={'wafer':w,'pdf':EXPECTED.get(w,'normal'),'yield':b['yield']}
    for label,obj in [('baseline',b),('candidate',c)]:
        kinds={a['kind'] for a in obj['alerts']}
        entry[label]={'categories':sorted(kinds),'alerts':[{'kind':a['kind'],'device':a['completed_devices']} for a in obj['alerts']],
                      'matched':sorted(kinds&exp),'extra':sorted(kinds-exp),'missing':sorted(exp-kinds),'exact':kinds==exp}
    comparisons.append(entry)
metrics={}
for label in ['baseline','candidate']:
    tp=sum(len(e[label]['matched']) for e in comparisons); fp=sum(len(e[label]['extra']) for e in comparisons); fn=sum(len(e[label]['missing']) for e in comparisons)
    metrics[label]={'expected_category_hits':tp,'expected_categories':7,'extra_categories':fp,'missing_categories':fn,
                    'category_precision':tp/(tp+fp),'category_recall':tp/7,'category_f1':2*tp/(2*tp+fp+fn),
                    'exact_wafer_category_set_matches':sum(e[label]['exact'] for e in comparisons),'wafer_count':25,
                    'normal_wafers_with_alerts':[e['wafer'] for e in comparisons if e['pdf']=='normal' and e[label]['categories']],
                    'normal_wafers':18,'alerted_wafers':sum(bool(e[label]['categories']) for e in comparisons)}
preservation={'accepted_alert_payloads_identical':all(canonical(a['alerts'])==canonical(b['alerts']) for a,b in zip(accepted['wafers'],base['wafers'])),
              'candidate_preserves_all_core_payloads':all(canonical(b['alerts'])==canonical([a for a in c['alerts'] if 'detector' not in a]) for b,c in zip(base['wafers'],candidate['wafers']))}
frontend_path=ROOT/'frontend/public/replay/summary.json'
front=read(frontend_path)
preservation['frontend_saved_summary']={'path':frontend_path.relative_to(ROOT).as_posix(),'sha256':sha(frontend_path),
                                      'equals_accepted_bytes':frontend_path.read_bytes()==(ROOT/'results/replay/summary.json').read_bytes(),
                                      'W25':next(w for w in front['wafers'] if w['wafer']==25)}
save('category_comparison.json',{'metrics':metrics,'wafer_comparison':comparisons,'preservation':preservation})
names,rows,x=load_matrix(ROOT/'source_review/training/Data')
groups=np.array([int(r['Wafer']) for r in rows]); sites=np.array([r['Site'] for r in rows])
family_idxs={}
for i,n in enumerate(names):
    if n in artifact['baselines']: family_idxs.setdefault(n.split('_',1)[1].rsplit('.',1)[0],[]).append(i)
def family_stat(w,n,family):
    idx=family_idxs[family]; a=x[groups==w][:n,idx]; ss=sites[groups==w][:n]
    sd=np.array([artifact['baselines'][names[i]]['sd'] for i in idx]); delta=[]; logs=[]; means=[]
    for s in sorted(set(ss)):
        v=a[ss==s]; half=len(v)//2; first,last=v[:half],v[-half:]
        delta.append((last.mean(0)-first.mean(0))/sd)
        logs.append(np.log(np.maximum(last.std(0),sd*.1)/np.maximum(first.std(0),sd*.1)))
        means.append(v.mean(0))
    delta=np.array(delta); logs=np.array(logs); avg=logs.mean(0)
    scores=[float(np.quantile(np.ptp(means,axis=0)/sd,.8)),float(np.quantile(abs(delta).max(0),.8)),float(np.quantile(avg,.8)),float(np.quantile(-avg,.8))]
    thresholds=artifact['family_thresholds'][family]
    return {'family':family,'completed':n,'test_count':len(idx),'q80_site_meanabs_spreadup_spreaddown':scores,'thresholds':thresholds,
            'ratios_to_gate':[v/t for v,t in zip(scores,thresholds)],
            'q80_signed_up_max_site':float(np.quantile(delta.max(0),.8)),
            'q80_signed_down_max_site':float(np.quantile((-delta).max(0),.8)),
            'spread_down_individual_test_exceedances':sum(float((-logs[:,j]).max())>artifact['baselines'][names[i]]['thresholds']['spread_down'] for j,i in enumerate(idx)),
            'median_geometric_recent_early_sd_ratio':float(np.exp(np.median(avg)))}
extra_details=[]
for w in base['wafers']:
    for alert in w['alerts']:
        record={k:v for k,v in alert.items() if k not in ['series','site_series','baseline']}
        record['wafer']=w['wafer']; record['pdf_expected']=EXPECTED.get(w['wafer'],'normal'); record['extra_relative_to_pdf']=alert['kind']!=EXPECTED.get(w['wafer'])
        if 'family' in alert: record['independent_family_statistics']=family_stat(w['wafer'],alert['completed_devices'],alert['family'])
        extra_details.append(record)
save('alert_diagnostics.json',extra_details)
models=RuntimeModels(OUT/'candidate_artifacts/runtime.json'); bursts=[]
for w in range(1,26):
    det=SparseBurstSpreadDown(models.sparse_burst); indices=np.where(groups==w)[0]
    for i in indices:
        det.add(rows[i]['Site'],dict(zip(names,x[i])),rows[i]['PID']); det.analyze()
    bursts.append({'wafer':w,'scans':det.scans,'subflow1_burst_devices':[i+1 for i,flag in enumerate(det.burst_flags('Main.subflow1')) if flag]})
save('sparse_burst_scans.json',bursts)
w25_stats=[family_stat(25,n,f) for n in range(32,81,8) for f,idx in family_idxs.items() if len(idx)>=20]
save('w25_core_family_scans.json',w25_stats)
rebuilt=read(OUT/'regression_rebuild/runtime.json'); validation=read(OUT/'regression_rebuild/validation.json')
manifest=flow_manifest(ROOT/'source_review/SmarTest/Case_Smt870/src/TestCase1',names)
source_manifest=read(OUT/'baseline_artifacts/manifest.json')
regression={'python':sys.executable,'numpy':np.__version__,'platform':platform.platform(),
            'matrix_shape':list(x.shape),'nonfinite_values':int((~np.isfinite(x)).sum()),
            'fresh_flow_stages_match_saved':canonical(manifest['stages'])==canonical(source_manifest['stages']),
            'stages':{}}
for stage in range(1,7):
    k=str(stage); a=artifact['models'][k]; b=rebuilt['models'][k]
    regression['stages'][k]={'eligible_features':len(manifest['stages'][stage]),'selected_features':len(a['features']),
        'all_selected_features_causal':set(a['features'])<=set(manifest['stages'][stage]),
        'feature_selection_matches_rebuild':a['features']==b['features'],
        'max_abs_rebuilt_parameter_difference':max(float(np.max(np.abs(np.array(a[field])-np.array(b[field])))) for field in ['median','mean','scale','coef','intercept']),
        'recomputed_heldout_metrics':validation['metrics'][k],
        'saved_heldout_metrics':base['validation']['metrics'][k],
        'runtime_fitted_replay_mae':base['prediction_in_sample_mae'][k],
        'candidate_runtime_fitted_replay_mae':candidate['prediction_in_sample_mae'][k]}
save('regression_check.json',regression)
print(json.dumps({'metrics':metrics,'preservation':{k:v for k,v in preservation.items() if k!='frontend_saved_summary'},'W2':raw[1],'regression':regression},indent=2))
