"""Independent B burst audit, no C imports or runtime integration.
Default immutable inputs: R3 CSV/runtime Git blobs. Default outputs: this fresh
follow-up folder. Reject output outside it, including symlink escapes.
"""
from collections import Counter
import argparse
import gzip
import json
import math
from pathlib import Path
import numpy as np
from workstreams.prediction.spread_audit import BASE, blob, digest, parse_export

HERE = Path(__file__).resolve().parent
SITES = ('1', '2', '3', '4')
PREFIXES = tuple(range(32, 81, 8))
FAMILIES = tuple('Main.subflow%d' % i for i in range(1, 7))
NORMALS = tuple(w for w in range(1, 26) if w not in (1, 3, 9, 14, 18, 23, 25))

def output_path(value):
    p = Path(value).resolve()
    if p != HERE and HERE not in p.parents:
        raise ValueError('Output must stay in distinct B burst follow-up folder')
    return p

def dump(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+chr(10), encoding='utf-8')

def fit_reference(datasets, references):
    """Site/test median and 1.4826*MAD on explicit reference wafers only.
    Zero MAD falls back to IQR/1.349, then population SD. Entirely constant,
    missing or <8 finite samples abstain. Self-fit is separately noncausal.
    """
    result = {}
    for site in SITES:
        x = np.concatenate([datasets[w][0][datasets[w][1]==site] for w in references])
        finite = np.isfinite(x); clean = np.where(finite,x,np.nan)
        median = np.nanmedian(clean,axis=0)
        mad = np.nanmedian(np.abs(clean-median),axis=0)
        iqr = np.nanquantile(clean,.75,axis=0)-np.nanquantile(clean,.25,axis=0)
        sd = np.nanstd(clean,axis=0)
        tolerance = np.maximum(1.,np.abs(median))*np.finfo(float).eps*32
        scale = mad*1.4826; method = np.full(len(median),'MAD',dtype='<U12')
        bad = ~np.isfinite(scale)|(scale<=tolerance)
        scale[bad]=iqr[bad]/1.349; method[bad]='IQR'
        bad = ~np.isfinite(scale)|(scale<=tolerance)
        scale[bad]=sd[bad]; method[bad]='SD'
        valid=(finite.sum(axis=0)>=8)&np.isfinite(scale)&(scale>tolerance)
        scale[~valid]=np.nan; method[~valid]='abstain'
        result[site]={'median':median,'mad':mad,'scale':scale,'n':finite.sum(axis=0),'method':method}
    return result

def standardize(x, sites, reference, raw_mad=False):
    z=np.full(x.shape,np.nan)
    for site in SITES:
        rows=sites==site; ref=reference[site]
        scale=ref['scale']/1.4826 if raw_mad else ref['scale']
        with np.errstate(over='ignore',invalid='ignore',divide='ignore'):
            z[rows]=np.abs(x[rows]-ref['median'])/scale
    z[~np.isfinite(z)]=np.nan
    return z

def burst_flags(z, families, threshold=20., minimum=4):
    flags, counts = {}, {}
    for family,js in families.items():
        v=z[:,js]; count=np.sum(v>threshold,axis=1)
        valid=np.isfinite(v).sum(axis=1)>=math.ceil(.95*len(js))
        flags[family]=np.where(valid,(count>=minimum).astype(float),np.nan)
        counts[family]=count
    return flags,counts

def fisher_greater(early, ne, late, nl):
    """Hypergeometric upper tail for one fixed table; no sequential guarantee.
    Device exchangeability/independence are assumptions, not proven by this p.
    """
    if min(ne,nl)<=0 or not (0<=early<=ne and 0<=late<=nl):
        raise ValueError('Invalid contingency table')
    total=early+late
    return sum(math.comb(ne,k)*math.comb(nl,total-k)
        for k in range(early,min(ne,total)+1) if 0<=total-k<=nl)/math.comb(ne+nl,total)

def scans_for(flags, sites, minimum_early=4):
    scans=[]
    for n in PREFIXES:
        if len(sites)<n: continue
        h=n//2
        balanced=all(np.sum(sites[:h]==s)==np.sum(sites[h:n]==s) and np.sum(sites[:h]==s)>=4 for s in SITES)
        for f,seq in flags.items():
            observed=seq[:n]
            if len(observed)!=n or not np.isfinite(observed).all():
                scans.append({'family':f,'n':n,'eligible':False,'site_balanced':bool(balanced),'score':0.})
                continue
            early,late=int(observed[:h].sum()),int(observed[h:].sum())
            p=fisher_greater(early,h,late,h); eligible=early>=minimum_early and early>late
            scans.append({'family':f,'n':n,'eligible':bool(eligible),'early':early,'late':late,'window_n':h,
                'rate_difference':(early-late)/h,'p_fixed_table':p,
                'score':-math.log10(max(p,1e-300)) if eligible else 0.,'site_balanced':bool(balanced)})
    return scans

def alerts(scans, cutoff, persistence=2, require_balance=False):
    streak,found=Counter(),{}
    for row in scans:
        f=row['family']; passed=row['eligible'] and row['score']>cutoff
        passed=passed and (row['site_balanced'] or not require_balance)
        streak[f]=streak[f]+1 if passed else 0
        if streak[f]>=persistence and f not in found: found[f]=dict(row)
    return list(found.values())

def calibration_gate(normal_scans):
    maximum=max((r['score'] for rows in normal_scans for r in rows),default=0.)
    return max(-math.log10(.05),maximum+1e-12),maximum

def controls(cutoffs):
    n,tests=80,24; sites=np.array([SITES[i%4] for i in range(n)])
    noise=np.tile(np.array([1. if (i//4)%2 else -1. for i in range(n)])[:,None],(1,tests))
    ref={s:{'median':np.zeros(tests),'scale':np.full(tests,1.4826)} for s in SITES}
    family={'control':list(range(tests))}; scenarios={'no_change':(noise.copy(),sites.copy())}
    for label,mask in [('stable_bursts',np.arange(n)%4==0),
            ('decreasing_bursts',(np.arange(n)<40)&(np.arange(n)%4==0)),
            ('increasing_bursts',(np.arange(n)>=40)&(np.arange(n)%4==0)),
            ('one_correlated_impulse',np.arange(n)==0),
            ('five_early_correlated_impulses',np.arange(n)<5)]:
        x=noise.copy(); x[mask,:4]+=100; scenarios[label]=x,sites.copy()
    for label,early,late in [('mean_step_away',0,100),('mean_step_to_reference',100,0),('constant_mean_offset',100,100)]:
        x=noise.copy(); x[:40]+=early; x[40:]+=late; scenarios[label]=x,sites.copy()
    x=noise.copy(); x[:40,:4]+=100; scenarios['four_correlated_mean_transitions']=x,sites.copy()
    x=noise.copy(); x[:40,0]+=100; scenarios['one_extreme_test']=x,sites.copy()
    x=noise.copy(); x[sites=='1',:4]+=100; scenarios['stable_site1_only_bursts']=x,sites.copy()
    mixed=np.array(['1']*32+['2']*16+['3']*16+['4']*16)
    x=noise.copy(); x[mixed=='1',:4]+=100; scenarios['site_mix_change_same_site_rates']=x,mixed
    x=noise.copy(); x[sites=='4']=np.nan; scenarios['missing_site']=x,sites.copy()
    results={}
    for name,(x,ss) in scenarios.items():
        flag,count=burst_flags(standardize(x,ss,ref),family); rows=scans_for(flag,ss)
        results[name]={'early_bursts':int(np.nansum(flag['control'][:40])),
            'late_bursts':int(np.nansum(flag['control'][40:])), 'scans':rows,
            'alerts':{k:alerts(rows,v) for k,v in cutoffs.items()},
            'balanced_alerts':{k:alerts(rows,v,require_balance=True) for k,v in cutoffs.items()}}
    simulations={}; rng=np.random.default_rng(20260919)
    for rate in (.05,.1,.2):
        hits=Counter()
        for _ in range(1000):
            rows=scans_for({'control':(rng.random(n)<rate).astype(float)},sites)
            for k,gate in cutoffs.items(): hits[k]+=bool(alerts(rows,gate))
        simulations[str(rate)]={'trials':1000,'false_alert_runs':dict(hits)}
    return {'fixtures':results,'stationary_seeded_burst_trials':simulations,
        'limits':['Four correlated test hits represent one device event, not four independent events.',
                  'Mean transitions keep additive noise unchanged within each regime.']}

def run(output):
    output=output_path(output); output.mkdir(parents=True,exist_ok=True)
    raw=blob('grp6_app/artifacts/runtime.json'); artifact=json.loads(raw)
    fit=artifact['detector_calibration']['normal_fit_wafers']
    inputs={'grp6_app/artifacts/runtime.json':digest(raw)}; datasets={}; metadata={}; names=None
    for w in range(1,26):
        path='source_review/training/Data/A12345_W%02d_RawResult.csv'%w
        raw=blob(path); inputs[path]=digest(raw); cols,meta,x,quality=parse_export(raw)
        if names is None: names=cols
        if names!=cols or len(x)!=80 or quality.any(): raise ValueError('Unexpected export quality/layout')
        datasets[w]=x,np.array([m['Site'] for m in meta]); metadata[w]=meta
    families={f:[j for j,name in enumerate(names) if name.split('_',1)[-1].rsplit('.',1)[0]==f] for f in FAMILIES}
    assert all(len(js)==500 for js in families.values())
    ref=fit_reference(datasets,fit)
    refjson={'reference_wafers':fit,'sites':{},'test_names':names,
        'scale_rule':'1.4826*MAD; zero fallback IQR/1.349 then SD; constants abstain'}
    for s,v in ref.items():
        refjson['sites'][s]={k:a.tolist() if k=='method' else [float(t) if np.isfinite(t) else None for t in a] for k,a in v.items()}
    with gzip.open(output/'normal-reference.json.gz','wt',encoding='utf-8') as handle: json.dump(refjson,handle,allow_nan=False)
    zs={w:standardize(x,ss,ref) for w,(x,ss) in datasets.items()}
    loo_z={w:standardize(*datasets[w],fit_reference(datasets,[v for v in fit if v!=w])) for w in fit}
    fixed={}; loo={}; flags_by_wafer={}; evidence=[]
    for w,z in zs.items():
        flags,counts=burst_flags(z,families); flags_by_wafer[w]=flags; fixed[w]=scans_for(flags,datasets[w][1])
        if w in fit: loo[w]=scans_for(burst_flags(loo_z[w],families)[0],datasets[w][1])
        for f,seq in flags.items():
            for i in np.flatnonzero(seq==1):
                site=metadata[w][i]['Site']; js=[j for j in families[f] if z[i,j]>20]
                evidence.append({'wafer':w,'device':int(i+1),'pid':metadata[w][i]['PID'],'site':site,'family':f,
                    'extreme_tests':len(js),'details':[{'test':names[j],'raw':float(datasets[w][0][i,j]),
                    'median':float(ref[site]['median'][j]),'mad':float(ref[site]['mad'][j]),
                    'scale':float(ref[site]['scale'][j]),'robust_z':float(z[i,j])} for j in js]})
    gate,nmax=calibration_gate([fixed[w] for w in fit]); lgate,lmax=calibration_gate(list(loo.values()))
    cutoffs={'nominal_unadjusted':-math.log10(.05),'normal_envelope':gate,
             'loo_normal_envelope':lgate,'bonferroni_42':-math.log10(.05/42)}
    baseline=json.loads(blob('results/replay/summary.json'))
    base_rows={int(r['wafer']):r for r in baseline['wafers']}; all_wafer=[]
    def counts_summary(flags):
        return {f:{'early':int(np.nansum(seq[:40])),'late':int(np.nansum(seq[40:])),
            'invalid_devices':int(np.sum(~np.isfinite(seq))),'burst_devices':(np.flatnonzero(seq==1)+1).tolist()} for f,seq in flags.items()}
    for w in range(1,26):
        all_wafer.append({'wafer':w,'normal_label':w in NORMALS,'reference_fit':w in fit,
            'baseline_alerts':base_rows[w]['alerts'],'family_counts':counts_summary(flags_by_wafer[w]),
            'research_additions':{k:alerts(fixed[w],v) for k,v in cutoffs.items()},
            'loo_research_additions':alerts(loo[w],lgate) if w in loo else None})
    sensitivity=[]
    for zcut,minimum in [(10,4),(20,2),(20,4),(20,6),(30,4),(40,4)]:
        rows={w:scans_for(burst_flags(z,families,zcut,minimum)[0],datasets[w][1]) for w,z in zs.items()}
        cg,cm=calibration_gate([rows[w] for w in fit])
        sensitivity.append({'z_threshold':zcut,'minimum_tests':minimum,'normal_gate':cg,'normal_max':cm,
            'w25_counts':counts_summary(burst_flags(zs[25],families,zcut,minimum)[0]),
            'additions':{str(w):alerts(r,cg) for w,r in rows.items() if alerts(r,cg)}})
    selfref=fit_reference(datasets,[25]); comparisons={}
    for label,z in [('normal_fit_scaled_MAD',zs[25]),('normal_fit_raw_MAD',standardize(*datasets[25],ref,True)),
            ('self_whole_wafer_scaled_MAD_NONCAUSAL',standardize(*datasets[25],selfref)),
            ('self_whole_wafer_raw_MAD_NONCAUSAL',standardize(*datasets[25],selfref,True))]:
        comparisons[label]=counts_summary(burst_flags(z,families)[0])
    result={'base':BASE,'inputs_sha256':inputs,'auditor_sha256':digest(Path(__file__).read_bytes()),
        'reference_wafers':fit,'reference_samples_per_site':260,'families':{f:len(js) for f,js in families.items()},
        'configuration':{'z_threshold':20,'minimum_tests':4,'minimum_early_bursts':4,'persistence':2,'prefixes':PREFIXES,
                         'window':'equal prefix halves','nominal_p':.05},
        'scale_methods':{s:dict(Counter(v['method'].tolist())) for s,v in ref.items()},
        'cutoffs':cutoffs,'normal_max_score':nmax,'loo_normal_max_score':lmax,'claim_comparison':comparisons,
        'wafer_results':all_wafer,'all_scans':{str(w):r for w,r in fixed.items()},'normal_loo_scans':{str(w):r for w,r in loo.items()},
        'normal_label_addition_wafers':{k:[r['wafer'] for r in all_wafer if r['normal_label'] and r['research_additions'][k]] for k in cutoffs},
        'sensitivity':sensitivity,'w25_fixed_7_vs_1_p':fisher_greater(7,40,1,40),
        'limits':['Fit-wafer evaluation reuses baseline data. LOO removes subject from median/MAD but reuses all13 scores for its envelope.',
            'All wafers are reused development data, never independent validation.',
            'Method/z20/min4 were proposed after W25 inspection; normal-only numerical fitting does not erase selection bias.',
            'Fisher p assumes exchangeable independent events for one table; not established for temporal/site data.',
            'Bonferroni42 covers fixed six-family/seven-scan multiplicity, not prior method/parameter selection.',
            'No runtime integration, callback-cost proof, model promotion, SDK or final-message acceptance.']}
    dump(output/'audit.json',result); dump(output/'burst-evidence.json',evidence); dump(output/'controls.json',controls(cutoffs))
    print(json.dumps({'w25':{k:v['Main.subflow1'] for k,v in comparisons.items()},'cutoffs':cutoffs,
        'normal_additions':result['normal_label_addition_wafers'],'w25_research_additions':all_wafer[-1]['research_additions'],
        'p7vs1':result['w25_fixed_7_vs_1_p']},indent=2))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--output',default=str(HERE))
    run(parser.parse_args().output)
