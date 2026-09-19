"""Calibrate per-test scan thresholds on normal wafers, keeping a holdout."""
import json
from pathlib import Path
import numpy as np
from .build_models import load_matrix

KINDS = ['site_imbalance','mean_drift_up','mean_drift_down','spread_up','spread_down']

def calibrate(source='source_review', artifacts='grp6_app/artifacts'):
    path=Path(artifacts)/'runtime.json'
    artifact=json.loads(path.read_text())
    names, rows, x=load_matrix(Path(source)/'training/Data')
    groups=np.array([int(r['Wafer']) for r in rows])
    sites=np.array([r['Site'] for r in rows])
    # Partition fixed before assessment; labels select normal calibration only.
    normal=[2,4,5,6,7,8,10,11,12,13,15,16,17,19,20,21,22,24]
    heldout=[w for w in normal if w%3==0]
    training=[w for w in normal if w not in heldout]
    idx=[i for i,n in enumerate(names) if n in artifact['baselines']]
    fit=x[np.isin(groups,training)][:,idx]
    sd=np.maximum(np.nanstd(fit,axis=0),1e-9)
    mean=np.nanmedian(fit,axis=0)
    ceiling=np.repeat(np.array([1.5,1.,1.,1.,1.])[:,None],len(idx),axis=1)
    families={}
    for j,i in enumerate(idx):
        family=names[i].split('_',1)[1].rsplit('.',1)[0]
        families.setdefault(family,[]).append(j)
    family_ceiling={f:np.array([.1,.1,.1,.1]) for f in families}
    for w in training:
        a=x[groups==w][:,idx]; s=sites[groups==w]
        for count in range(24,len(a)+1,8):
            seq=[a[:count][s[:count]==v] for v in sorted(set(s))]
            means=np.array([v.mean(0) for v in seq])
            imbalance=np.ptp(means,axis=0)/sd
            delta=np.array([(v[-(len(v)//2):].mean(0)-v[:len(v)//2].mean(0))/sd for v in seq])
            ratio=np.array([np.log(np.maximum(v[-(len(v)//2):].std(0),sd*.1)/np.maximum(v[:len(v)//2].std(0),sd*.1)) for v in seq])
            score=np.array([imbalance,delta.max(0),-delta.min(0),ratio.max(0),-ratio.min(0)])
            ceiling=np.maximum(ceiling,score)
            if count>=32:
                family_metrics=np.array([imbalance,np.max(abs(delta),axis=0),np.mean(ratio,axis=0),-np.mean(ratio,axis=0)])
                for family,js in families.items():
                    family_ceiling[family]=np.maximum(family_ceiling[family],np.quantile(family_metrics[:,js],.8,axis=1))
    for j,i in enumerate(idx):
        artifact['baselines'][names[i]]={'mean':float(mean[j]),'sd':float(sd[j]),
             'thresholds':dict(zip(KINDS,(ceiling[:,j]*1.5).tolist()))}
    artifact['baseline_wafers']=training
    artifact['family_thresholds']={f:(v*1.2).tolist() for f,v in family_ceiling.items()}
    artifact['detector_calibration']={'normal_fit_wafers':training,'heldout_normal_wafers':heldout,
         'method':'per-test maximum across normal prefix scans times 1.5; population standard deviation',
         'scan_interval_devices':8,'minimum_parametric_devices':24,'minimum_yield_devices':32,
         'warning':'Normal check wafers were inspected during tuning; all detector assessment is development evidence, not independent validation'}
    artifact['detector_calibration']['family_gate']='80th percentile across related tests; normal prefix maximum times 1.2, one scan for site/mean, two consecutive scans for spread. Normal check wafers were inspected during development; not a pristine holdout.'
    path.write_text(json.dumps(artifact,allow_nan=False),encoding='utf-8')
    print(artifact['detector_calibration'])

if __name__=='__main__': calibrate()
