"""Assess site-specific family dispersion changes without wafer-specific rules."""
import json
from pathlib import Path
import numpy as np
from .build_models import load_matrix

def run():
    artifact=json.loads(Path('grp6_app/artifacts/runtime.json').read_text())
    names,rows,x=load_matrix(Path('source_review/training/Data'))
    idx=[i for i,n in enumerate(names) if n in artifact['baselines']]
    x=x[:,idx]; names=[names[i] for i in idx]
    sd=np.array([artifact['baselines'][n]['sd'] for n in names])
    wafers=np.array([int(r['Wafer']) for r in rows]); sites=np.array([r['Site'] for r in rows])
    families={}
    for i,n in enumerate(names): families.setdefault(n.split('_',1)[1].rsplit('.',1)[0],[]).append(i)
    normal=artifact['detector_calibration']['normal_fit_wafers']
    records=[]
    thresholds={}
    for w in sorted(set(wafers)):
        data=x[wafers==w]; ss=sites[wafers==w]
        for count in range(32,81,8):
            for s in sorted(set(ss)):
                seq=data[:count][ss[:count]==s]; half=len(seq)//2
                change=np.log(np.maximum(seq[-half:].std(0),sd*.1)/np.maximum(seq[:half].std(0),sd*.1))
                for family,js in families.items():
                    if len(js)<20: continue
                    for direction,sign in [('spread_down',-1),('spread_up',1)]:
                        value=float(np.quantile(sign*change[js],.9))
                        key=(family,direction)
                        if w in normal: thresholds[key]=max(thresholds.get(key,.1),value)
                        records.append({'wafer':int(w),'count':count,'site':str(s),'family':family,
                                        'kind':direction,'score':value})
    streak={}; detections=[]
    for r in records:
        key=(r['wafer'],r['site'],r['family'],r['kind'])
        threshold=thresholds[(r['family'],r['kind'])]*1.2
        streak[key]=streak.get(key,0)+1 if r['score']>threshold else 0
        if streak[key]>=2:
            detections.append(dict(r,threshold=threshold,persistence=streak[key]))
    Path('results/site_spread_diagnosis.json').write_text(json.dumps({
        'method':'per-site family q90 log SD ratio; normal-fit prefix maximum x1.2; two scans',
        'thresholds':{f:{d:v*1.2 for (ff,d),v in thresholds.items() if ff==f} for f in families},
        'detections':detections},indent=2))
    for r in detections: print(r)

if __name__=='__main__': run()
