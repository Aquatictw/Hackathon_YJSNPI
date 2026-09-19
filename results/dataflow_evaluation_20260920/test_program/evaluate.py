"""Read retained evidence only; write derived artifacts beside this script. Stdlib only."""
import csv
import hashlib
import json
import math
import re
import struct
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
INPUTS = {}

def read(path):
    p = ROOT / path
    raw = p.read_bytes()
    INPUTS[path] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    return raw.decode('utf-8-sig')

def save(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2, allow_nan=False) + '\n', encoding='utf-8')

def metrics(rows):
    errors = [r['signed_error'] for r in rows]
    return {'n': len(rows), 'mae': sum(map(abs, errors))/len(rows),
            'rmse': math.sqrt(sum(x*x for x in errors)/len(rows)),
            'bias_predicted_minus_actual': sum(errors)/len(rows),
            'max_absolute_error': max(map(abs, errors))}

all_rows = []
datasets = {}
for name, path in [('production', 'results/vm_production/grp6_core_prod3_evidence.jsonl'),
                   ('engineering', 'results/vm_engineering/grp6_core_eng_evidence.jsonl')]:
    events = [json.loads(s) for s in read(path).splitlines() if s.strip()]
    assert len({e['event_id'] for e in events}) == len(events)
    requests = {}
    fields = ['run_id', 'tester', 'lot', 'wafer', 'test_id', 'stage', 'request_id']
    for e in events:
        if e['kind'] == 'prediction_request':
            for site, predicted in e['predictions'].items():
                key = tuple(e[f] for f in fields) + (str(site), e['prediction_ids'][site], e['device_ids'][site])
                assert key not in requests
                requests[key] = (e, predicted)
    rows, joined = [], set()
    for e in events:
        if e['kind'] != 'prediction_actual':
            continue
        key = tuple(e[f] for f in fields) + (str(e['site']), e['prediction_id'], e['device_id'])
        assert key in requests and key not in joined, key
        joined.add(key)
        req, pred = requests[key]
        assert pred == e['predicted'] and req['sequence'] < e['sequence']
        error = pred - e['actual']
        assert math.isclose(abs(error), e['absolute_error'], abs_tol=1e-12)
        assert req['source_mode'] == e['source_mode'] and req['model_sha256'] == e['model_sha256']
        row = {f: e[f] for f in fields}
        row.update(dataset=name, site=str(e['site']), prediction_id=e['prediction_id'],
                   device_id=e['device_id'], part=e['part'], touchdown=e['touchdown'],
                   prediction_event_id=req['event_id'], actual_event_id=e['event_id'],
                   prediction_sequence=req['sequence'], actual_sequence=e['sequence'],
                   predicted=pred, actual=e['actual'], signed_error=error, absolute_error=abs(error),
                   coverage=req['coverage'][str(e['site'])], latency_ms=req['latency_ms'],
                   unit=e.get('unit'), quality=e.get('quality'))
        rows.append(row)
    assert len(joined) == len(requests)
    all_rows.extend(rows)
    reqs = [e for e in events if e['kind']=='prediction_request']
    devices = [e for e in events if e['kind']=='device_end']
    invalid = []
    for e in events:
        if e['kind']=='production_action_response':
            try:
                json.loads(e['response'])
            except json.JSONDecodeError as ex:
                invalid.append({'sequence':e['sequence'], 'event_id':e['event_id'], 'error':str(ex)})
    result = {'input':path, 'event_counts':dict(Counter(e['kind'] for e in events)),
              'sequences_contiguous': [e['sequence'] for e in events] == list(range(1,len(events)+1)),
              'model_hashes':sorted({e['model_sha256'] for e in events}),
              'actual_scopes':sorted({(r['run_id'],r['tester'],r['lot'],r['wafer']) for r in rows}),
              'request_count':len(reqs), 'unique_devices':len({r['device_id'] for r in rows}),
              'bins':dict(Counter(str(d['sbin']) for d in devices)),
              'yield':sum(d['sbin']==1 for d in devices)/len(devices),
              'overall':metrics(rows),
              'by_stage':{str(s):metrics([r for r in rows if r['stage']==s]) for s in range(1,7)},
              'by_stage_site':{f'{s}/{site}':metrics([r for r in rows if r['stage']==s and r['site']==site]) for s in range(1,7) for site in ['1','2','3','4']},
              'minimum_coverage':min(r['coverage'] for r in rows),
              'callback_latency_ms':{'min':min(r['latency_ms'] for r in reqs),'max':max(r['latency_ms'] for r in reqs)},
              'waited_requests':sum(bool(r.get('waited_for_measurements')) for r in reqs),
              'invalid_production_responses':invalid,
              'unit_values':sorted({str(r['unit']) for r in rows}),
              'alerts':[e for e in events if e['kind']=='alert'],
              'measurement_sample_count':sum(e['kind']=='measurement' for e in events)}
    datasets[name] = (events, rows, result)
    save(name+'_metrics.json', result)

with (OUT / 'prediction_actual_pairs.csv').open('w', newline='', encoding='utf-8') as f:
    writer=csv.DictWriter(f,fieldnames=list(all_rows[0]))
    writer.writeheader(); writer.writerows(all_rows)

# Independently match parsed response JSON to distinct tester action lines and adjacent execution.
events, prod_rows, prod_result = datasets['production']
tester_path='results/vm_production/grp6_core_prod3_tester.txt'
lines=read(tester_path).splitlines()
actions=[]
for i,line in enumerate(lines):
    if 'Actions => ' in line:
        try:
            action=json.loads(line.split('Actions => ',1)[1])
        except json.JSONDecodeError:
            continue
        window=lines[i+1:i+5]
        actions.append((i+1,action,any('Exec Pass: 1 Exec Fail: 0' in s for s in window),window))
receipts=[]
used=set()
for req in (e for e in events if e['kind']=='prediction_request'):
    target=json.loads(req['response'])
    matches=[a for a in actions if a[0] not in used and a[1]==target and a[2]]
    assert len(matches)==1, req['request_id']
    line,_,_,window=matches[0]; used.add(line)
    receipts.append({'request_id':req['request_id'], 'stage':req['stage'],'tester_action_line':line, 'adjacent_execution':window})
save('prediction_receipts.json', {'tester_path':tester_path,'matched':len(receipts),'receipts':receipts,
     'limit':'Exact response and adjacent execution; tester output does not embed core request IDs. Not anomaly display proof.'})

# Compare all six actual targets as a device vector to all supplied training rows.
# ORE emits binary32 values in recorded evidence; normalize CSV numbers to binary32.
def f32(x):
    return struct.unpack('!f',struct.pack('!f',float(x)))[0]
vectors=defaultdict(dict)
for r in prod_rows:
    vectors[r['device_id']][r['stage']]=r['actual']
training=[]
target_headers=None
for p in sorted((ROOT/'source_review/training/Data').glob('*.csv')):
    table=list(csv.reader(read(p.relative_to(ROOT).as_posix()).splitlines()))
    headers=table[0]
    indexes=[next(i for i,h in enumerate(headers) if re.search(r'_Main.sensor'+str(s)+r'#',h)) for s in range(1,7)]
    target_headers=[headers[i] for i in indexes]
    for row in table[5:]:
        if not row or not row[0]: continue
        training.append({'path':p.relative_to(ROOT).as_posix(),'pid':row[0],'lot':row[1], 'wafer':row[2], 'site':row[3], 'vector':tuple(f32(row[i]) for i in indexes)})
vector_set={r['vector'] for r in training}
overlap=[device for device,v in vectors.items() if tuple(v[s] for s in range(1,7)) in vector_set]
eng_rows=datasets['engineering'][1]
first_prod={(r['stage'],r['site']):(r['predicted'],r['actual']) for r in prod_rows if r['touchdown']==1}
eng_matches=sum(first_prod.get((r['stage'],r['site']))==(r['predicted'],r['actual']) for r in eng_rows)
save('data_overlap.json',{'training_files':25,'training_rows':len(training),
     'training_lots':sorted({r['lot'] for r in training}),'target_headers':target_headers,
     'comparison':'Six-target vectors ignoring lot/wafer/site identity; CSV converted to IEEE754 binary32; no fuzzy matching.',
     'production_device_vectors':len(vectors),'exact_matching_vectors':len(overlap),'matching_device_ids':overlap,
     'engineering_pairs_identical_to_first_production_touchdown':eng_matches,
     'engineering_pairs':len(eng_rows),
     'conclusion':'Exact six-target reuse can be tested, but absence of a match cannot establish independent generation, independence of features, or no transformed training-data reuse.'})

for directory in ['source_review/SmarTest','Case_Event']:
    for p in sorted((ROOT/directory).rglob('*')):
        if p.is_file():
            raw=p.read_bytes(); INPUTS[p.relative_to(ROOT).as_posix()]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
for name in ['results/vm_production/receiver_observation_20260919.json','results/vm_production/alert_fix_deployment_20260919.json']:
    read(name)
save('input_manifest.json',INPUTS)
print(json.dumps({'production':prod_result['overall'],'by_stage':prod_result['by_stage'],
                  'exact_training_vector_matches':len(overlap),'engineering_repeated_pairs':eng_matches,
                  'production_receipts':len(receipts)},indent=2))
