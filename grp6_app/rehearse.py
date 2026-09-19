"""CSV replay of the production detector and six stage-restricted models."""
import argparse
import csv
import json
import time
from pathlib import Path
from .runtime import RuntimeModels, WaferDetector
from .data import TARGETS

EXPECTED={1:'site_imbalance',3:'low_yield',9:'low_yield',14:'mean_drift_up',
          18:'mean_drift_down',23:'spread_up',25:'spread_down'}

def run(data, output, artifacts=None):
    base=Path(artifacts) if artifacts else Path(__file__).parent/'artifacts'
    models=RuntimeModels(base/'runtime.json')
    manifest=json.loads((base/'manifest.json').read_text())
    allowed={int(k):set(v) for k,v in manifest['stages'].items()}
    output=Path(output); output.mkdir(parents=True,exist_ok=True)
    wafers=[]; errors={str(s):[] for s in range(1,7)}; max_scan=0.; max_prediction=0.
    with (output/'replay.jsonl').open('w',encoding='utf-8') as log:
        for path in sorted(Path(data).glob('*_RawResult.csv')):
            detector=models.detector(); alerts=[]
            with path.open(encoding='utf-8-sig',newline='') as handle:
                reader=csv.reader(handle); header=next(reader)
                for _ in range(4): next(reader)
                for row in reader:
                    if not row or not row[0].isdigit(): continue
                    meta=dict(zip(header[:10],row[:10])); wafer=int(meta['Wafer'])
                    values={k:float(v) for k,v in zip(header[10:],row[10:]) if v.strip()}
                    for stage in range(1,7):
                        current={n:values[n] for n in models.models[str(stage)]['features'] if n in allowed[stage] and n in values}
                        started=time.perf_counter(); prediction,coverage=models.predict(stage,current)
                        max_prediction=max(max_prediction,time.perf_counter()-started)
                        if prediction is None: raise ValueError('Missing replay features')
                        errors[str(stage)].append(abs(prediction-values[TARGETS[stage]]))
                    detector.add(meta['Site'],values,meta['SBin']=='1',meta['PID'])
                    started=time.perf_counter(); new=detector.analyze(); max_scan=max(max_scan,time.perf_counter()-started)
                    for alert in new:
                        alerts.append(alert); log.write(json.dumps({'kind':'alert','mode':'replay','wafer':wafer,'lot':meta['Lot'],'alert':alert})+'\n')
                for alert in detector.analyze(True):
                    alerts.append(alert); log.write(json.dumps({'kind':'alert','mode':'replay','wafer':wafer,'lot':meta['Lot'],'alert':alert})+'\n')
            expected=EXPECTED.get(wafer)
            found=next((a['completed_devices'] for a in alerts if a['kind']==expected),None)
            wafers.append({'wafer':wafer,'devices':detector.completed,'yield':detector.good/max(detector.completed,1),
                           'expected':expected or 'normal','expected_first_device':found,'alerts':alerts})
            print('W{:02d} yield {:.1%}: {}'.format(wafer,wafers[-1]['yield'], ', '.join(a['kind']+'@'+str(a['completed_devices']) for a in alerts) or 'no alerts'),flush=True)
    holdout=models.artifact['detector_calibration']['heldout_normal_wafers']
    summary={'mode':'replay','live_integration':'NOT YET PROVED', 'wafers':wafers,
       'heldout_normal_wafers':holdout,'heldout_normal_wafers_alerted':[w['wafer'] for w in wafers if w['wafer'] in holdout and w['alerts']],
       'expected_anomalies_detected':sum(w['expected_first_device'] is not None for w in wafers),'expected_anomaly_wafers':len(EXPECTED),
       'max_scan_ms':max_scan*1000,'max_model_ms':max_prediction*1000,
       'prediction_in_sample_mae':{k:sum(v)/len(v) for k,v in errors.items()},
       'validation':json.loads((base/'validation.json').read_text()),
       'calibration':models.artifact['detector_calibration'],
       'supplementary_detectors':[{'detector':'sparse_burst_spread_down_v1','status':models.sparse_burst_status,
           'calibration':models.sparse_burst.summary() if models.sparse_burst else None,
           'alerts':[{'wafer':w['wafer'],'kind':a['kind'],'family':a.get('family'),'completed_devices':a['completed_devices']}
                     for w in wafers for a in w['alerts'] if a.get('detector')=='sparse_burst_spread_down_v1']}],
       'limitations':['Replay is not live SDK evidence.','Prediction replay uses fitted training devices; use wafer-held-out metrics for accuracy.',
       'Abnormal wafers are development examples. Five normal holdout wafers are too few to estimate deployment false alarm rates reliably.',
       'The sparse-burst spread_down supplement was designed after W15/W25 were examined; its W25 match is development evidence, not independent validation.',
       'W2 is labeled normal but its SBin-derived yield is 53.75%; the measured yield alert must not be suppressed.']}
    (output/'summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False),encoding='utf-8')
    from .report import render_evidence
    render_evidence(summary,output/'report.html')
    print('heldout alerted',summary['heldout_normal_wafers_alerted'],'expected detected',summary['expected_anomalies_detected'],'max scan ms',summary['max_scan_ms'],flush=True)
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('data');p.add_argument('--output',default='results/replay');p.add_argument('--artifacts')
    a=p.parse_args();run(a.data,a.output,a.artifacts)
