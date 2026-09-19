"""Read-only spread diagnostics; no threshold changes or wafer-specific rules."""
import json
from pathlib import Path
import numpy as np
from .build_models import load_matrix

def run():
    artifact=json.loads(Path('grp6_app/artifacts/runtime.json').read_text())
    names,rows,x=load_matrix(Path('source_review/training/Data'))
    selected=[i for i,n in enumerate(names) if n in artifact['baselines']]
    x=x[:,selected]; names=[names[i] for i in selected]
    wafers=np.array([int(r['Wafer']) for r in rows])
    sites=np.array([r['Site'] for r in rows])
    sd=np.array([artifact['baselines'][n]['sd'] for n in names])
    families={}
    for i,n in enumerate(names):
        families.setdefault(n.split('_',1)[1].rsplit('.',1)[0],[]).append(i)
    report=[]
    for w in sorted(set(wafers)):
        data=x[wafers==w]; site=sites[wafers==w]
        entry={'wafer':int(w),'families':{}}
        for family,idx in families.items():
            if len(idx)<20: continue
            ratios=[]; slopes=[]; relative=[]
            for s in sorted(set(site)):
                v=data[site==s][:,idx]; half=len(v)//2
                first=v[:half].std(0); last=v[-half:].std(0)
                relative.append(v.std(0)/sd[idx])
                ratios.append(np.log(np.maximum(last,sd[idx]*.1)/np.maximum(first,sd[idx]*.1)))
                # Absolute deviation around per-site full-wafer median:
                # diagnostic only; not a causal online feature.
                deviation=np.abs(v-np.median(v,axis=0))/sd[idx]
                t=np.arange(len(v)); t=t-t.mean()
                slopes.append((t @ deviation)/(t @ t))
            avg=np.mean(ratios,axis=0)
            gate=artifact['family_thresholds'][family][3]
            entry['families'][family]={'spread_down_q80':float(np.quantile(-avg,.8)),
                'spread_down_q90_q95_q99':np.quantile(-avg,[.9,.95,.99]).tolist(),
                'per_test_exceedances':sum(float(max(-r[j] for r in ratios))>artifact['baselines'][names[i]]['thresholds']['spread_down'] for j,i in enumerate(idx)),
                'strongest_tests':[{'test':names[idx[j]],'mean_log_decrease':float(-avg[j]),
                     'max_site_log_decrease':float(max(-r[j] for r in ratios)),
                     'threshold':artifact['baselines'][names[idx[j]]]['thresholds']['spread_down']} for j in np.argsort(avg)[:5]],
                'relative_sd_q10_q50_q90':np.quantile(np.mean(relative,axis=0),[.1,.5,.9]).tolist(),
                'gate':gate,'median_last_first_ratio':float(np.exp(np.median(avg))),
                'median_abs_deviation_slope':float(np.median(np.mean(slopes,axis=0)))}
        report.append(entry)
    Path('results/spread_diagnosis.json').write_text(json.dumps(report,indent=2))
    for e in report:
        best=min(e['families'].items(),key=lambda kv:kv[1]['relative_sd_q10_q50_q90'][0])
        print(e['wafer'],best)

if __name__=='__main__':run()
