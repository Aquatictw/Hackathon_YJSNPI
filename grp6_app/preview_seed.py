"""Bounded CSV/model replay for the preview; never tester execution evidence."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

from .data import TARGETS
from .runtime import RuntimeModels


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def generate(source, artifacts=None):
    source = Path(source)
    artifacts = Path(artifacts) if artifacts else Path(__file__).parent / 'artifacts'
    models = RuntimeModels(artifacts / 'runtime.json')
    manifest = json.loads((artifacts / 'manifest.json').read_text(encoding='utf-8'))
    allowed = {int(k): set(v) for k, v in manifest['stages'].items()}
    provenance = {
        'format': 'grp6-preview-seed-v1', 'source_file': source.name,
        'source_sha256': digest(source), 'model_sha256': digest(artifacts / 'runtime.json'),
        'manifest_sha256': digest(artifacts / 'manifest.json'),
        'selection': 'First device of each site, at most four sites, in CSV row order.',
        'limitations': [
            'Fitted-data replay, not held-out prediction accuracy or live evidence.',
            'Timestamps are synthetic ordering aids; no tester action was requested.',
            'Units and runtime flags remain unverified. Measurements are a selected subset.',
        ],
    }
    seed = hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest()[:20]
    events = []
    seen = set()
    def emit(kind, meta, **fields):
        sequence = 10000 + len(events) + 1
        events.append(dict(schema_version='1', event_id=f'preview-{seed}-{sequence}',
                           sequence=sequence, mode='replay', event_type=kind,
                           timestamp=1789776000 + sequence, tester_id='grp6-replay',
                           run_id='grp6-replay-demo', lot_id=meta['Lot'], wafer_id=meta['Wafer'],
                           replay_provenance=provenance, **fields))
    with source.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.reader(handle)
        header = next(reader)
        if header[:4] != ['PID', 'Lot', 'Wafer', 'Site']:
            raise ValueError('Expected challenge CSV identity columns')
        for _ in range(4):
            next(reader)
        for row_index, row in enumerate(reader, start=6):
            if not row or not row[0].isdigit():
                continue
            meta = dict(zip(header[:10], row[:10]))
            site = meta['Site']
            if site in seen:
                continue
            if not site.isdigit() or not 1 <= int(site) <= 256:
                raise ValueError('Invalid CSV site')
            seen.add(site)
            values = {}
            for key, value in zip(header[10:], row[10:]):
                try:
                    number = float(value)
                except ValueError:
                    continue
                if math.isfinite(number):
                    values[key] = number
            device = f'preview-{seed}-row{row_index}-site{site}'
            measured = set(TARGETS.values())
            for stage in range(1, 7):
                features = models.models[str(stage)]['features']
                if not set(features) <= allowed[stage] or set(features) & set(TARGETS.values()):
                    raise ValueError(f'Stage {stage} model violates causal feature manifest')
                current = {name: values[name] for name in features if name in values}
                prediction, coverage = models.predict(stage, current)
                request_id = f'{device}-stage{stage}'
                prediction_id = f'{request_id}-prediction'
                emit('prediction_request', meta, request_id=request_id, stage=stage,
                     device_ids={site: device}, prediction_ids={site: prediction_id},
                     predictions={site: prediction} if prediction is not None else {},
                     coverage={site: coverage}, status='replay_computed' if prediction is not None else 'insufficient_current_data',
                     model_sha256=provenance['model_sha256'], unit=None)
                actual = values.get(TARGETS[stage])
                emit('prediction_actual', meta, request_id=request_id, prediction_id=prediction_id,
                     device_id=device, site=site, stage=stage, actual=actual,
                     absolute_error=abs(prediction-actual) if prediction is not None and actual is not None else None,
                     prediction_status='replay_computed', unit=None)
                measured.update(features)
            measurements = [dict(canonical_feature=name, value=values[name], unit=None,
                                 quality='csv_units_unverified') for name in sorted(measured) if name in values]
            emit('device_completed', meta, device_id=device, site=int(site), part_id=meta['PID'],
                 measurements=measurements, expected_count=len(header)-10, received_count=len(measurements),
                 missing_count=max(0, len(header)-10-len(measurements)), data_quality='partial')
            if len(seen) == 4:
                break
    if not events:
        raise ValueError('No usable CSV devices')
    return events, {**provenance, 'seed_id': seed, 'sites': sorted(seen), 'event_count': len(events)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('results/replay/predictions.jsonl'))
    args = parser.parse_args()
    events, provenance = generate(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(''.join(json.dumps(event, allow_nan=False, sort_keys=True)+'\n' for event in events), encoding='utf-8')
    args.output.with_suffix('.provenance.json').write_text(json.dumps(provenance, indent=2)+'\n', encoding='utf-8')
    print(f'Wrote {len(events)} replay events to {args.output}')
