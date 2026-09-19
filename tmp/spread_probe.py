exec(open('tmp/analyze_data.py').read().split('for w in range(1,26):')[0])
families={}
for j,i in enumerate(idx):families.setdefault(names[i].split('_',1)[1].rsplit('.',1)[0],[]).append(j)
fit=artifact['detector_calibration']['normal_fit_wafers']
stds={w:x[groups==w][:,idx].std(0) for w in range(1,26)}
reference=np.maximum(np.median([stds[w] for w in fit],axis=0),1e-9)
for w in range(1,26):
 ratio=stds[w]/reference
 print(w,[(f,round(float(np.quantile(ratio[js],.2)),2),round(float(np.median(ratio[js])),2),round(float(np.quantile(ratio[js],.8)),2)) for f,js in families.items() if f not in ('Main','Main.IDDQ_flow')],flush=True)
