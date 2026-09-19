"""Causal sparse-burst rate diagnostic, not an accepted spread detector.
Normal-fit scales/empirical cutoff are frozen externally. Sequential alpha
spending bounds the union of exact-test rejections ONLY under exchangeability
of burst labels conditional on the pooled count. Site/time dependence may break
that model. Nominal modes are explicit, uncorrected research comparisons.
"""
from collections import deque
import math

CONFIG = {'window_devices':80, 'minimum_devices':32, 'scan_interval':8,
          'minimum_early_bursts':4, 'minimum_extreme_tests':4, 'z_threshold':20.,
          'familywise_alpha':.05, 'persistence':2, 'normal_margin':1.2,
          'minimum_per_site_half':4, 'maximum_evidence_tests':8}


def fisher_decrease(a, b, n1, n2):
    """Hypergeometric P(early>=a | total=a+b); no scipy dependency."""
    if not (0<=a<=n1 and 0<=b<=n2 and n1>0 and n2>0):
        raise ValueError('Invalid two-window binomial counts')
    total=a+b
    numerator=sum(math.comb(n1,k)*math.comb(n2,total-k)
                  for k in range(a,min(n1,total)+1) if 0<=total-k<=n2)
    return numerator/math.comb(n1+n2,total)


class SparseBurstDetector:
    def __init__(self, calibration, mode='corrected'):
        if mode not in ('corrected','nominal_two','nominal_one'):
            raise ValueError('Unknown research comparison')
        if calibration['config']!=CONFIG:
            raise ValueError('Unsupported frozen configuration')
        self.mode=mode
        self.sites=tuple(calibration['sites'])
        self.families={f:tuple(ts) for f,ts in calibration['families'].items()}
        tests=[t for ts in self.families.values() for t in ts]
        if (not 1<=len(self.sites)<=8 or len(set(self.sites))!=len(self.sites)
                or not 1<=len(self.families)<=16 or len(tests)>4096
                or len(set(tests))!=len(tests) or any(len(ts)<4 for ts in self.families.values())):
            raise ValueError('Invalid bounded layout')
        self.baselines=calibration['by_site']
        for s in self.sites:
            for t in tests:
                b=self.baselines[s][t]
                if not math.isfinite(b['median']) or not math.isfinite(b['scale']) or b['scale']<=0:
                    raise ValueError('Invalid robust baseline')
        self.empirical_p_cutoff=calibration['empirical_p_cutoff']
        if not 0<self.empirical_p_cutoff<=1:
            raise ValueError('Invalid calibrated p cutoff')
        self.calibration_sha256=calibration['calibration_sha256']
        self.windows={f:deque(maxlen=CONFIG['window_devices']) for f in self.families}
        self.streak=dict.fromkeys(self.families,0)
        self.emitted=set()
        self.completed=self.last_analyzed=self.scan_index=0
        self.invalid_scope=False
        self.latest_device=[]
        self.latest_scans=[]

    def add(self, site, values):
        self.completed+=1
        site=str(site)
        if site not in self.sites:
            self.invalid_scope=True
        self.latest_device=[]
        for family,tests in self.families.items():
            valid=not self.invalid_scope
            hits=0
            examples=[]
            if valid:
                for test in tests:
                    raw=values.get(test)
                    if isinstance(raw,bool):
                        valid=False
                        continue
                    try:
                        value=float(raw)
                    except (TypeError,ValueError,OverflowError):
                        valid=False
                        continue
                    if not math.isfinite(value):
                        valid=False
                        continue
                    base=self.baselines[site][test]
                    z=abs(value-base['median'])/base['scale']
                    if not math.isfinite(z):
                        valid=False
                        continue
                    if z>CONFIG['z_threshold']:
                        hits+=1
                        if len(examples)<CONFIG['maximum_evidence_tests']:
                            examples.append({'test':test,'raw':value,'median':base['median'],
                                'mad':base['mad'],'scale':base['scale'],'abs_robust_z':z})
            record={'completed_devices':self.completed,'site':site,'family':family,
                    'valid':valid,'burst':hits>=CONFIG['minimum_extreme_tests'] if valid else None,
                    'extreme_tests':hits,'evidence':examples,
                    'evidence_truncated':hits>len(examples)}
            self.windows[family].append(record)
            self.latest_device.append(record)

    def analyze(self, final=False):
        self.latest_scans=[]
        if self.completed==self.last_analyzed or self.completed%CONFIG['scan_interval']:
            return []
        self.last_analyzed=self.completed
        if self.completed<CONFIG['minimum_devices']:
            return []
        self.scan_index+=1
        # Sum_{k>=1}1/[k(k+1)]=1. No assumed final wafer length.
        allocated=CONFIG['familywise_alpha']/(len(self.families)*self.scan_index*(self.scan_index+1))
        cutoff=min(self.empirical_p_cutoff,allocated if self.mode=='corrected' else .05)
        persistence=1 if self.mode=='nominal_one' else CONFIG['persistence']
        alerts=[]
        for family,window in self.windows.items():
            records=list(window)
            half=len(records)//2
            early,late=records[:half],records[-half:]
            counts_a={s:sum(r['site']==s for r in early) for s in self.sites}
            counts_b={s:sum(r['site']==s for r in late) for s in self.sites}
            ready=(not self.invalid_scope and all(r['valid'] for r in records) and
                   counts_a==counts_b and min(counts_a.values())>=CONFIG['minimum_per_site_half'])
            a=sum(r['burst'] is True for r in early)
            b=sum(r['burst'] is True for r in late)
            p=fisher_decrease(a,b,half,half) if ready else None
            passed=ready and a>=CONFIG['minimum_early_bursts'] and a>b and p<=cutoff
            self.streak[family]=min(persistence,self.streak[family]+1) if passed else 0
            scan={'family':family,'completed_devices':self.completed,'scan_index':self.scan_index,
                  'mode':self.mode,'ready':ready,'early_bursts':a,'late_bursts':b,
                  'early_devices':half,'late_devices':half,'rate_difference':(a-b)/half,
                  'p_value':p,'p_cutoff':cutoff,'alpha_allocation':allocated,
                  'passed':passed,'streak':self.streak[family]}
            self.latest_scans.append(scan)
            if passed and self.streak[family]>=persistence and family not in self.emitted:
                self.emitted.add(family)
                alerts.append({**scan,'kind':'spread_down','detector':'sparse_extreme_burst_decline_v1',
                    'interpretation':'Decline in extreme-burst incidence; not proof of reduced noise variance',
                    'scope':'supplementary offline research','calibration_sha256':self.calibration_sha256,
                    'burst_evidence':[r for r in records if r['burst']]})
        return alerts
