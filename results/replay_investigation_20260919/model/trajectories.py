"""Diagnostic trajectories for emitted representative tests; no fitting or promotion."""
import json, sys
from pathlib import Path
import numpy as np
ROOT=Path.cwd(); OUT=ROOT/'results/replay_investigation_20260919/model'; sys.path.insert(0,str(ROOT))
from grp6_app.build_models import load_matrix
names,rows,x=load_matrix(ROOT/'source_review/training/Data')
groups=np.array([int(r['Wafer']) for r in rows]); sites=np.array([r['Site'] for r in rows])
summary=json.loads((OUT/'baseline/summary.json').read_text())
out=[]
for w in summary['wafers']:
    if w['wafer'] not in [14,18,23]: continue
    for a in w['alerts']:
        idx=names.index(a['test']); mask=(groups==w['wafer']) & (sites==a['site']); vals=x[mask,idx]
        blocks=[vals[i:i+4] for i in range(0,len(vals),4)]
        out.append({'wafer':w['wafer'],'kind':a['kind'],'test':a['test'],'site':a['site'],
                    'device_prefix_at_alert':a['completed_devices'],
                    'site_values':vals.tolist(),'blocks_of_four_site_values':[{'n':len(b),'mean':float(b.mean()),'sd':float(b.std())} for b in blocks]})
ids=[(i,n) for i,n in enumerate(names) if n.startswith('25_') or 'waferid' in n.lower()]
identity={'encoded_wafer_columns':{n:np.unique(x[groups==2,i]).tolist() for i,n in ids}}
(OUT/'representative_trajectories.json').write_text(json.dumps({'trajectories':out,'W2_encoded_identity':identity},indent=2),encoding='utf-8')
print(json.dumps({'trajectories':out,'W2_encoded_identity':identity},indent=2))
