exec(open('tmp/analyze_data.py').read().split('for w in range(1,26):')[0])
kinds=['site_imbalance','mean_drift_up','mean_drift_down','spread_up','spread_down']
threshold=np.array([[artifact['baselines'][names[i]]['thresholds'][k] for i in idx] for k in kinds])
for w in range(1,26):
 a=x[groups==w][:,idx]; s=sites[groups==w]; stats=[]; streak=None
 for count in range(24,81,8):
  seq=[a[:count][s[:count]==v] for v in sorted(set(s))]
  means=np.array([v.mean(0) for v in seq]); imbalance=np.ptp(means,axis=0)/sd
  delta=np.array([(v[-(len(v)//2):].mean(0)-v[:len(v)//2].mean(0))/sd for v in seq])
  ratio=np.array([np.log(np.maximum(v[-(len(v)//2):].std(0),sd*.1)/np.maximum(v[:len(v)//2].std(0),sd*.1)) for v in seq])
  scores=np.array([imbalance,delta.max(0),-delta.min(0),ratio.max(0),-ratio.min(0)])/threshold
  streak=np.where(scores>1,1 if streak is None else streak+1,0); stats.append((streak>=3).sum(axis=1))
 print(w,np.max(stats,axis=0).tolist(),flush=True)
