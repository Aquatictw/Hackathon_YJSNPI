"""Portable inference and anomaly evidence, requiring only Python stdlib."""
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from .sparse_burst import ARTIFACT_NAME, SparseBurstSpreadDown, load_calibration


class RuntimeModels:
    def __init__(self, path, sparse_burst_path=None):
        self.artifact = json.loads(Path(path).read_text(encoding='utf-8'))
        self.models = self.artifact['models']
        self.by_number = defaultdict(list)
        for name in self.artifact['columns']:
            self.by_number[int(name.split('_', 1)[0])].append(name)
        # Separate artifact keeps the prediction model SHA unchanged; a missing
        # or invalid file disables only the supplement (fail closed).
        self.sparse_burst, self.sparse_burst_status = load_calibration(
            sparse_burst_path or Path(path).with_name(ARTIFACT_NAME))

    def detector(self):
        return WaferDetector(self.artifact['baselines'], self.artifact.get('family_thresholds'),
                             self.sparse_burst, self.sparse_burst_status)

    def feature(self, number, suite, pin=None):
        names = self.by_number.get(int(number), [])
        if suite:
            names = [n for n in names if n.split('_',1)[1].split('#')[0] == suite
                     or n.split('_',1)[1].split('#')[0].endswith('.' + suite)]
        if pin is not None:
            names = [n for n in names if n.endswith('#' + str(pin))]
        return names[0] if len(names) == 1 else None

    def predict(self, stage, values):
        model = self.models.get(str(stage))
        if not model:
            return None, 0.
        present = sum(n in values and math.isfinite(values[n]) for n in model['features'])
        coverage = present/len(model['features'])
        # Missing streaming data must be visible, not silently imputed as a
        # supposedly current device. Training missing values use medians.
        if present != len(model['features']):
            return None, coverage
        result = model['intercept']
        for i, name in enumerate(model['features']):
            result += ((values[name]-model['mean'][i])/model['scale'][i])*model['coef'][i]
        return (result if math.isfinite(result) else None), coverage


class WaferDetector:
    def __init__(self, baselines, family_thresholds=None, sparse_burst=None, sparse_burst_status=None):
        self.sparse_burst = SparseBurstSpreadDown(sparse_burst, sparse_burst_status)
        self.baselines = baselines
        self.family_thresholds = family_thresholds or {}
        self.family_streak = {}
        self.values = defaultdict(list)
        self.site_values = defaultdict(lambda: defaultdict(list))
        self.completed = 0
        self.good = 0
        self.emitted = set()
        self.yield_series = []
        self.last_analyzed = 0

    def add(self, site, values, passed, device=None):
        self.sparse_burst.add(site, values, device)
        self.completed += 1
        if passed:
            self.good += 1
        self.yield_series.append(self.good/self.completed)
        for name, value in values.items():
            if name in self.baselines and math.isfinite(value):
                self.values[name].append(value)
                self.site_values[name][str(site)].append(value)

    def analyze(self, final=False):
        # Supplementary alerts keep their own emission state and never alter
        # or suppress the core detector's payloads.
        alerts = self._analyze_core(final)
        alerts.extend(self.sparse_burst.analyze(final))
        return alerts

    def _analyze_core(self, final=False):
        if self.completed == self.last_analyzed or (not final and self.completed % 8):
            return []
        self.last_analyzed = self.completed
        best = {}
        family_metrics = defaultdict(list)
        def offer(kind, score, test, message, observed, reference, series, site='all'):
            if kind in self.emitted:
                return
            candidate = {'kind': kind, 'score': score, 'test': test, 'message': message,
                         'observed': observed, 'reference': reference, 'series': list(series),
                         'site': site, 'completed_devices': self.completed,
                         'site_series': {s:list(v) for s,v in self.site_values.get(test,{}).items()},
                         'baseline': self.baselines.get(test),
                         'suggestion': {'site_imbalance': 'Compare socket/contact and site calibration.',
                           'low_yield': 'Review failing bins and recent process or setup changes.',
                           'mean_drift_up': 'Check thermal settling and measurement reference stability.',
                           'mean_drift_down': 'Check thermal settling and measurement reference stability.',
                           'spread_up': 'Check intermittent contact and noise sources.',
                           'spread_down': 'Check clipping, stale results, and range changes.'}[kind]}
            family = test.split('_',1)[-1].rsplit('.',1)[0]
            key=(kind,family)
            if key not in best or score > best[key]['score']:
                best[key] = candidate
        n = max(self.completed,1)
        rate = self.good/n
        z = 1.645
        upper = (rate+z*z/(2*n)+z*math.sqrt(rate*(1-rate)/n+z*z/(4*n*n)))/(1+z*z/n)
        if self.completed >= 32 and rate < .8 and (upper < .8 or final):
            rate = self.good/self.completed
            offer('low_yield', .8-rate, 'completed_device_results',
                  'Yield {:.1%} ({}/{}) below 80%'.format(rate,self.good,self.completed), rate,.8,self.yield_series)
        for name, series in self.values.items():
            if len(series) < 24:
                continue
            base = self.baselines[name]
            sd = max(base['sd'], 1e-9)
            groups = {s:v for s,v in self.site_values[name].items() if len(v)>=4}
            imbalance=0.
            changes=[]
            log_ratios=[]
            if len(groups)>=2:
                means = {s:sum(v)/len(v) for s,v in groups.items()}
                lo, hi = min(means,key=means.get), max(means,key=means.get)
                delta = (means[hi]-means[lo])/sd
                imbalance=delta
                threshold = base.get('thresholds',{}).get('site_imbalance',2.5)
                if delta>threshold:
                    offer('site_imbalance',delta/threshold,name,
                          '{}: site {} vs {} differs by {:.2f} baseline SD'.format(name,hi,lo,delta),
                          means[hi],means[lo],series,hi)
            # Compare temporal windows within each site, avoiding site ordering
            # artifacts when devices from different sites are interleaved.
            for site, seq in groups.items():
                if len(seq)<6:
                    continue
                half = len(seq)//2
                first, last = seq[:half], seq[-half:]
                first_mean, last_mean = sum(first)/len(first), sum(last)/len(last)
                delta = (last_mean-first_mean)/sd
                changes.append(abs(delta))
                kind = 'mean_drift_up' if delta>0 else 'mean_drift_down'
                threshold = base.get('thresholds',{}).get(kind,1.)
                if abs(delta)>threshold:
                    offer(kind,abs(delta)/threshold,name,
                          '{} site {}: mean changed {:+.2f} baseline SD'.format(name,site,delta),
                          last_mean,first_mean,seq,site)
                first_sd = math.sqrt(sum((v-first_mean)**2 for v in first)/len(first))
                last_sd = math.sqrt(sum((v-last_mean)**2 for v in last)/len(last))
                ratio = max(last_sd,sd*.1)/max(first_sd,sd*.1)
                log_ratios.append(math.log(ratio))
                kind = 'spread_up' if ratio>1 else 'spread_down'
                threshold = base.get('thresholds',{}).get(kind,math.log(2.5))
                if abs(math.log(ratio))>threshold:
                    kind = 'spread_up' if ratio>1 else 'spread_down'
                    offer(kind,abs(math.log(ratio))/threshold,name,
                          '{} site {}: spread ratio {:.2f}'.format(name,site,ratio),
                          last_sd,first_sd,seq,site)
            if changes and log_ratios:
                family=name.split('_',1)[1].rsplit('.',1)[0]
                avg_log=sum(log_ratios)/len(log_ratios)
                family_metrics[family].append([imbalance,max(changes),avg_log,-avg_log])
        gates={}
        def quantile(values):
            ordered=sorted(values); pos=.8*(len(ordered)-1); i=int(pos)
            return ordered[i]+(ordered[min(i+1,len(ordered)-1)]-ordered[i])*(pos-i)
        for family,metrics in family_metrics.items():
            if family not in self.family_thresholds or self.completed<32: continue
            scores=[quantile([row[k] for row in metrics])/max(threshold,.1)
                    for k,threshold in enumerate(self.family_thresholds[family])]
            for k,score in enumerate(scores):
                key=(family,k)
                self.family_streak[key]=self.family_streak.get(key,0)+1 if score>1 else 0
                gates[key]=(self.family_streak[key]>=(2 if k>=2 else 1),score)
        accepted={}
        for (kind,family),alert in best.items():
            index={'site_imbalance':0,'mean_drift_up':1,'mean_drift_down':1,'spread_up':2,'spread_down':3}.get(kind)
            if self.family_thresholds and index is not None:
                passed,score=gates.get((family,index),(False,0.))
                if not passed: continue
                alert['family']=family
                alert['family_score_over_threshold']=score
                alert['family_persistence_scans']=self.family_streak[(family,index)]
            if kind not in accepted or alert['score']>accepted[kind]['score']:
                accepted[kind]=alert
        self.emitted.update(accepted)
        return list(accepted.values())
