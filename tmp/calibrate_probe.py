exec(open('tmp/analyze_data.py').read().split('for w in range(1,26):')[0])
normal=artifact['baseline_wafers']
metrics={}
for w in range(1,26):
 a=x[groups==w][:,idx]; s=sites[groups==w]; result=[]
 for count in range(24,81,8):
  seq=[a[:count][s[:count]==v] for v in sorted(set(s))]
  means=np.array([v.mean(0) for v in seq]); imbalance=np.ptp(means,axis=0)/sd
  delta=np.array([(v[len(v)//2:].mean(0)-v[:len(v)//2].mean(0))/sd for v in seq])
  ratio=np.array([np.log(np.maximum(v[len(v)//2:].std(0),sd*.1)/np.maximum(v[:len(v)//2].std(0),sd*.1)) for v in seq])
  result.append(np.array([imbalance,delta.max(0),-delta.min(0),ratio.max(0),-ratio.min(0)]))
 metrics[w]=np.array(result)
ceiling=np.maximum(np.stack([metrics[w] for w in normal if w!=2]).max(axis=(0,1)),np.array([1.5,1,1,1,1])[:,None])*1.3
for w in range(1,26):
 ratio=metrics[w]/ceiling; flat=ratio.max(axis=0)
 print(w,[(kind,round(float(v.max()),2),names[idx[v.argmax()]]) for kind,v in zip(['site','up','down','wider','narrower'],flat)],flush=True)
