exec(open('tmp/analyze_data.py').read().split('for w in range(1,26):')[0])
families={}
for j,i in enumerate(idx):
 family=names[i].split('_',1)[1].rsplit('.',1)[0]
 families.setdefault(family,[]).append(j)
allstats={}
for w in range(1,26):
 a=x[groups==w][:,idx];s=sites[groups==w];stats=[]
 for count in range(32,81,8):
  seq=[a[:count][s[:count]==v] for v in sorted(set(s))]
  means=np.array([v.mean(0) for v in seq]);imbalance=np.ptp(means,axis=0)/sd
  delta=np.array([(v[-(len(v)//2):].mean(0)-v[:len(v)//2].mean(0))/sd for v in seq])
  ratio=np.array([np.log(np.maximum(v[-(len(v)//2):].std(0),sd*.1)/np.maximum(v[:len(v)//2].std(0),sd*.1)) for v in seq])
  # Median over related tests absorbs independent noise; absolute drift accommodates inverse responses.
  scores=np.array([imbalance,np.max(abs(delta),axis=0),np.mean(ratio,axis=0),-np.mean(ratio,axis=0)])
  stats.append(np.array([np.quantile(scores[:,js],.8,axis=1) for js in families.values()]))
 allstats[w]=np.array(stats)
fit=artifact['detector_calibration']['normal_fit_wafers']
ceil=np.max([allstats[w] for w in fit],axis=(0,1))*1.2
for w in range(1,26):
 scores=(allstats[w]/np.maximum(ceil,.1)).max(0)
 print(w,[(f,[round(v,2) for v in arr]) for f,arr in zip(families,scores) if arr.max()>1],flush=True)
