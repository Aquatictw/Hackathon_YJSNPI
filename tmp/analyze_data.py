import sys, json, numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from grp6_app.build_models import load_matrix
names,rows,x=load_matrix('source_review/training/Data')
artifact=json.loads(Path('grp6_app/artifacts/runtime.json').read_text())
groups=np.array([int(r['Wafer']) for r in rows]); sites=np.array([r['Site'] for r in rows])
idx=[i for i,n in enumerate(names) if n in artifact['baselines']]
sd=np.array([artifact['baselines'][names[i]]['sd'] for i in idx])
for w in range(1,26):
 a=x[groups==w][:,idx]; s=sites[groups==w]; seq=[a[s==v] for v in sorted(set(s))]
 means=np.array([v.mean(0) for v in seq]); imb=np.ptp(means,axis=0)/sd
 delta=np.array([(v[len(v)//2:].mean(0)-v[:len(v)//2].mean(0))/sd for v in seq])
 ratio=np.array([v[len(v)//2:].std(0)/np.maximum(v[:len(v)//2].std(0),sd*.1) for v in seq])
 print(w,'yield',sum(r['SBin']=='1' for r in rows if int(r['Wafer'])==w)/len(a),'imb',round(imb.max(),2),names[idx[imb.argmax()]],'drift',round(delta.max(),2),round(delta.min(),2),'spread',round(ratio.max(),2),round(ratio.min(),2),flush=True)
print('Ambiguous selected features:')
from collections import Counter
c=Counter(n.split('#')[0] for n in names)
for stage,m in artifact['models'].items():
 print(stage,[n for n in m['features'] if c[n.split('#')[0]]>1])
