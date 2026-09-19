"""Development diagnostic for dispersion relative to normal wafers.

The existing detector compares early/late windows and can miss a wafer whose
dispersion is reduced from its first device. No production thresholds changed.
"""
import json
from pathlib import Path
import numpy as np
from .build_models import load_matrix

def run():
    artifact=json.loads(Path('grp6_app/artifacts/runtime.json').read_text())
    names,rows,x=load_matrix(Path('source_review/training/Data'))
    idx=[i for i,n in enumerate(names) if n in artifact['baselines']]
    x=x[:,idx]; names=[names[i] for i in idx]
    wafers=np.array([int(r['Wafer']) for r in rows])
    sites=np.array([r['Site'] for r in rows])
    normal=artifact['detector_calibration']['normal_fit_wafers']
    families={}
    for i,n in enumerate(names): families.setdefault(n.split('_',1)[1].rsplit('.',1)[0],[]).append(i)
    def spread(w,count,within=True):
        v=x[wafers==w][:count]; s=sites[wafers==w][:count]
        return np.sqrt(np.mean([v[s==site].var(0) for site in sorted(set(s))],axis=0)) if within else v.std(0)
    report=[]
    for count in range(32,81,8):
        fit=np.array([spread(w,count) for w in normal])
        # Prespecified conservative screen: 30% below every normal-fit wafer
        # at the same prefix size; assessment remains development evidence.
        floor=np.min(fit,axis=0)*.7
        for w in sorted(set(wafers)):
            observed=spread(w,count)
            hits=observed<floor
            families_hit={f:{'hits':int(hits[js].sum()),'tests':len(js),
                             'fraction':float(hits[js].mean())} for f,js in families.items()}
            strongest=np.argsort(observed/np.maximum(floor,1e-12))[:12]
            report.append({'wafer':int(w),'count':count,'families':families_hit,
                'strongest':[{'test':names[i],'sd':float(observed[i]),
                              'normal_floor':float(floor[i])} for i in strongest]})
    Path('results/baseline_spread_diagnosis.json').write_text(json.dumps(report,indent=2))
    for r in report:
        hits={f:v for f,v in r['families'].items() if v['hits']>=3 and v['fraction']>=.05}
        if hits: print(r['wafer'],r['count'],hits)
    across=[]
    for count in range(32,81,8):
        fit=np.array([spread(w,count,False) for w in normal])
        floor=np.min(fit,axis=0)*.7
        for w in sorted(set(wafers)):
            observed=spread(w,count,False); hits=observed<floor
            fs={f:{'hits':int(hits[js].sum()),'fraction':float(hits[js].mean())} for f,js in families.items()}
            across.append({'wafer':int(w),'count':count,'families':fs})
            significant={f:v for f,v in fs.items() if v['hits']>=3 and v['fraction']>=.05}
            if significant: print('ACROSS',w,count,significant)
    Path('results/across_site_spread_diagnosis.json').write_text(json.dumps(across,indent=2))

if __name__=='__main__': run()
