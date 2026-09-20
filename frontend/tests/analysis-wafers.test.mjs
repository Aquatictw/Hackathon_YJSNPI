import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisWafers} from '../lib/rtdi/analysis-wafers.ts';
import {parseSnapshot} from '../lib/rtdi/dashboard.ts';
import {normalizeExporterBatch} from '../lib/rtdi/exporter-wire.ts';

const time = '2026-09-20T09:00:00Z';
const later = '2026-09-20T09:01:00Z';
function event(event_id, fields = {}) {
  return {event_id, type: 'heartbeat', run_id: 'r', tester_id: 't',
    source_mode: 'replay', timestamp: time, lot_id: 'L1', wafer_id: 'W1', ...fields};
}
function alert(id, fields = {}) {
  return event(id, {type: 'evidence', evidence_id: 'e-' + id, ...fields});
}
function prediction(id, fields = {}) {
  return event(id, {type: 'prediction', request_id: 'request', device_id: 'device',
    stage: 1, site_id: 1, prediction: 0, ...fields});
}
function actual(id, fields = {}) {
  return event(id, {type: 'prediction_actual', request_id: 'request', device_id: 'device',
    stage: 1, site_id: 1, actual: 0, ...fields});
}
function snapshot(events = [], evidence = events.filter(e => e.type === 'evidence'), run = {}) {
  return parseSnapshot({run: {run_id: 'r', tester_id: 't', edge_id: 'edge', mode: 'replay',
    lot_id: null, wafer_id: null, last_event_at: later, data_quality: 'partial', ...run},
  events, evidence, incidents: [], commands: []}, 'r', 't');
}
function wafer(rows, lot = 'L1', id = 'W1') {
  return rows.find(row => row.lotId === lot && row.waferId === id);
}
function withoutMetrics(row) {
  assert.equal(Object.hasOwn(row, 'yieldRatio'), false);
  assert.equal(Object.hasOwn(row, 'devices'), false);
}

test('exact lot/wafer identity survives delimiter collisions, case, leading zeros and missing scope', () => {
  const scopes = [['L1', 'W1'], ['L2', 'W1'], ['L1', 'w1'], ['L1', '01'], ['L1', '1'],
    ['a:b', 'c'], ['a', 'b:c'], [undefined, 'W1'], ['L1', undefined], [undefined, undefined],
    ['null', 'null']];
  const rows = analysisWafers(snapshot(scopes.map(([lot_id, wafer_id], i) =>
    alert('e' + i, {lot_id, wafer_id}))));
  assert.equal(rows.length, scopes.length);
  assert.equal(new Set(rows.map(row => row.key)).size, scopes.length);
  for (const [lot, id] of scopes) {
    const row = wafer(rows, lot ?? null, id ?? null);
    assert.deepEqual(JSON.parse(row.key), [lot ?? null, id ?? null]);
    assert.equal(row.alerts, 1);
    withoutMetrics(row);
  }
});

test('metadata is a placeholder only when both events and evidence are empty', () => {
  const metadata = {lot_id: 'L2', wafer_id: 'W9'};
  const unknown = alert('unknown', {lot_id: undefined, wafer_id: undefined});
  for (const [events, evidence] of [[[unknown], []], [[], [unknown]]]) {
    const rows = analysisWafers(snapshot(events, evidence, metadata));
    assert.equal(rows.length, 1);
    assert.equal(wafer(rows, null, null).alerts, 1);
    assert.equal(wafer(rows, 'L2', 'W9'), undefined);
  }
  const rows = analysisWafers(snapshot([], [], metadata));
  assert.equal(rows.length, 1);
  const known = wafer(rows, 'L2', 'W9');
  assert.equal(known.alerts, 0);
  assert.equal(Object.hasOwn(known, 'lastEventAt'), false);
  withoutMetrics(known);
  assert.deepEqual(analysisWafers(snapshot()), []);
});

test('lot-only L2 after L1/W1 never creates a synthetic L2/W1 from retained metadata', () => {
  const first = event('first', {type: 'run_summary', yield: 0.9, completed_devices: 80});
  const nextLot = event('next-lot', {lot_id: 'L2', wafer_id: undefined, timestamp: later});
  const metadata = {lot_id: 'L2', wafer_id: 'W1'};
  for (const events of [[first, nextLot], [nextLot, first]]) {
    const rows = analysisWafers(snapshot(events, [], metadata));
    assert.deepEqual(rows.map(row => [row.lotId, row.waferId]), [['L1', 'W1'], ['L2', null]]);
    assert.equal(wafer(rows, 'L2', 'W1'), undefined);
    assert.equal(wafer(rows).yieldRatio, 0.9);
    assert.equal(wafer(rows).devices, 80);
    withoutMetrics(wafer(rows, 'L2', null));
    assert.equal(wafer(rows, 'L2', null).lastEventAt, later);
  }
});

test('metadata neither duplicates its exact group nor fills a missing lot on another record', () => {
  const data = snapshot([event('same'), event('unknown-lot', {lot_id: undefined})], [],
    {lot_id: 'L1', wafer_id: 'W1'});
  const rows = analysisWafers(data);
  assert.equal(rows.length, 2);
  assert.equal(wafer(rows).lastEventAt, time);
  assert.equal(wafer(rows, null, 'W1').lastEventAt, time);
  const lotOnly = analysisWafers(snapshot([], [], {lot_id: 'L2'}));
  assert.equal(wafer(lotOnly, 'L2', null).alerts, 0);
});

test('yield and completed devices come from the latest exact summary, including supplied zero', () => {
  const rows = analysisWafers(snapshot([
    event('zero', {type: 'run_summary', timestamp: later, yield: 0, completed_devices: 0}),
    event('old', {type: 'run_summary', yield: 1, completed_devices: 80}),
    event('other-lot', {type: 'run_summary', lot_id: 'L2', yield: 0.5, completed_devices: 40}),
    event('unknown', {type: 'run_summary', lot_id: undefined, wafer_id: undefined, yield: 0.75}),
  ]));
  assert.equal(wafer(rows).yieldRatio, 0);
  assert.equal(wafer(rows).devices, 0);
  assert.equal(wafer(rows, 'L2').yieldRatio, 0.5);
  assert.equal(wafer(rows, null, null).yieldRatio, 0.75);
  assert.equal(Object.hasOwn(wafer(rows, null, null), 'devices'), false);
});

test('latest applicable summary omission does not revive older yield or counts', () => {
  const older = event('old', {type: 'run_summary', yield: 0.9, completed_devices: 80});
  for (const fields of [{yield: 0}, {completed_devices: 0}]) {
    const row = analysisWafers(snapshot([older, event('new', {type: 'run_summary', timestamp: later, ...fields})]))[0];
    assert.equal(Object.hasOwn(row, 'yieldRatio'), Object.hasOwn(fields, 'yield'));
    assert.equal(Object.hasOwn(row, 'devices'), Object.hasOwn(fields, 'completed_devices'));
    if ('yield' in fields) assert.equal(row.yieldRatio, 0);
    if ('completed_devices' in fields) assert.equal(row.devices, 0);
  }
});

test('alert yield, site summaries, measurements and projected lifecycle records cannot set wafer metrics', () => {
  const excluded = [
    alert('low-yield', {kind: 'low_yield', yield: 0.1, completed_devices: 999}),
    event('site', {type: 'run_summary', site_id: 1, yield: 0.2, completed_devices: 20}),
    event('sites', {type: 'run_summary', site_ids: [1, 2], yield: 0.3, completed_devices: 30}),
    event('measurement', {type: 'measurement', test_name: 'test', value: 1, yield: 0.4, completed_devices: 40}),
    event('device', {type: 'run_summary', message: 'Edge exporter event: device_completed', yield: 0.5}),
  ].map(record => ({...record, timestamp: later}));
  withoutMetrics(analysisWafers(snapshot(excluded))[0]);
  const rows = analysisWafers(snapshot([event('summary', {type: 'run_summary', yield: 0.8, completed_devices: 80}), ...excluded]));
  assert.equal(rows[0].yieldRatio, 0.8);
  assert.equal(rows[0].devices, 80);
  assert.equal(rows[0].lastEventAt, later);
  assert.equal(rows[0].alerts, 1);
});

test('real exporter normalization preserves explicit summaries and excludes later generic projections', () => {
  const raw = (id, event_type, timestamp, fields = {}) => ({schema_version: 1, event_id: id,
    sequence: timestamp, mode: 'replay', event_type, timestamp, tester_id: 't', run_id: 'r',
    lot_id: 'L1', wafer_id: 1, ...fields});
  const normalize = events => normalizeExporterBatch({schema_version: 1, edge_id: 'edge', batch_id: 'batch', events}).batch.events;
  const summary = raw('summary', 'run_summary', 100, {yield_fraction: 0, completed_devices: 80, good_devices: 0});
  const tail = raw('tail', 'lot_end', 200);
  let row = analysisWafers(snapshot(normalize([tail, summary])))[0];
  assert.equal(row.waferId, '1');
  assert.equal(row.yieldRatio, 0);
  assert.equal(row.devices, 80);
  row = analysisWafers(snapshot(normalize([summary, tail, raw('missing', 'run_summary', 300)])))[0];
  assert.equal(row.yieldRatio, 0);
  assert.equal(row.devices, 80);
  assert.equal(row.lastEventAt, new Date(300_000).toISOString());
  withoutMetrics(analysisWafers(snapshot(normalize([raw('empty', 'run_summary', 300)])))[0]);
});

test('events/evidence retries deduplicate by event ID; evidence-only records are retained', () => {
  const first = alert('first');
  const second = alert('second', {evidence_id: first.evidence_id, timestamp: later});
  const data = snapshot([first, {...first}, prediction('p'), prediction('p'), actual('a'), actual('a')],
    [{...first}, second, {...second}]);
  const row = analysisWafers(data)[0];
  assert.equal(row.alerts, 2);
  assert.equal(row.predictions, 1);
  assert.equal(row.matchedActuals, 1);
  assert.equal(row.lastEventAt, later);
});

test('late actuals join without relying on arrival order, and distinct actual IDs remain ambiguous', () => {
  const p = prediction('p');
  const a = actual('a', {timestamp: later});
  assert.equal(analysisWafers(snapshot([p]))[0].matchedActuals, 0);
  const expected = analysisWafers(snapshot([p, a]));
  assert.equal(expected[0].matchedActuals, 1);
  assert.deepEqual(analysisWafers(snapshot([a, p, a])), expected);
  assert.equal(analysisWafers(snapshot([p, a, actual('different')]))[0].matchedActuals, 0);
});

test('actuals do not cross exact lot/wafer groups or supplied request provenance', () => {
  for (const fields of [{lot_id: 'L2'}, {wafer_id: 'W2'}, {lot_id: undefined},
    {wafer_id: undefined}, {lot_id: undefined, wafer_id: undefined}, {site_id: 2},
    {stage: 2}, {attempt: 2}, {original_request_id: 'other'}, {source_mode: 'live'}]) {
    const rows = analysisWafers(snapshot([prediction('p'), actual('a', fields)]));
    assert.equal(wafer(rows).matchedActuals, 0, JSON.stringify(fields));
    assert.equal(rows.reduce((sum, row) => sum + row.matchedActuals, 0), 0);
  }
});

test('prediction availability and zero inline actual are preserved; ambiguous requests are unmatched', () => {
  const rows = analysisWafers(snapshot([prediction('inline', {actual: 0}),
    prediction('unavailable', {request_id: 'missing', prediction: null, response_status: 'insufficient_data'})]));
  assert.equal(rows[0].predictions, 2);
  assert.equal(rows[0].matchedActuals, 1);
  const ambiguous = analysisWafers(snapshot([prediction('p1'), prediction('p2'), actual('a')]));
  assert.equal(ambiguous[0].predictions, 2);
  assert.equal(ambiguous[0].matchedActuals, 0);
});

test('source time outranks arrival order and sequence; ties use sequence then event ID deterministically', () => {
  const records = [
    event('old-high-sequence', {type: 'run_summary', sequence: 100, yield: 1}),
    event('new-low-sequence', {type: 'run_summary', timestamp: later, sequence: 1, yield: 0.1}),
    event('a', {type: 'run_summary', timestamp: '2026-09-20T17:01:00+08:00', sequence: 2, yield: 0.2}),
    event('z', {type: 'run_summary', timestamp: later, sequence: 2, yield: 0.3}),
  ];
  const expected = analysisWafers(snapshot(records));
  assert.equal(expected[0].yieldRatio, 0.3);
  assert.equal(expected[0].lastEventAt, later);
  for (let i = 0; i < records.length; i++) {
    const reordered = [...records.slice(i), ...records.slice(0, i)].reverse();
    assert.deepEqual(analysisWafers(snapshot(reordered)), expected);
  }
});

test('all output groups are order independent and the input snapshot remains unchanged', () => {
  const data = snapshot([alert('b', {lot_id: 'B'}), event('summary', {type: 'run_summary', yield: 0}),
    prediction('p'), actual('a'), event('unknown', {wafer_id: undefined})],
  [alert('only-evidence', {lot_id: 'A'}), alert('b', {lot_id: 'B'})]);
  const before = structuredClone(data);
  const expected = analysisWafers(data);
  assert.deepEqual(data, before);
  assert.deepEqual(analysisWafers({...data, events: [...data.events].reverse(), evidence: [...data.evidence].reverse()}), expected);
});

test('conflicting duplicate IDs and mixed run/tester scope fail closed even for unparsed callers', () => {
  const data = snapshot([alert('same')]);
  assert.throws(() => analysisWafers({...data, evidence: [alert('same', {wafer_id: 'W2'})]}), /Conflicting/);
  for (const fields of [{run_id: 'other'}, {tester_id: 'other'}]) {
    assert.throws(() => analysisWafers({...data, events: [event('foreign', fields)]}), /scope/);
  }
});
