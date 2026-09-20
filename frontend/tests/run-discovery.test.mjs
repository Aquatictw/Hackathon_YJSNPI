import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunDiscovery, initialRunDiscovery, isRecordedCapture, isTrainingReplay, runChoiceKey, runModeLabel, storedRunName, storedRunSourceLabel, selectedStoredRun } from '../lib/rtdi/run-discovery.ts';
import { readSourceSession, writeSourceSession, selectBackendSource } from '../lib/rtdi/source-session.ts';
import { zhTW } from '../lib/rtdi/locale-zh-TW.ts';

const run = (tester = 'a', id = 'shared', mode = 'live') => ({ tester_id: tester, run_id: id, mode, edge_id: 'edge', last_event_at: '2026-09-20T02:00:00Z', updated_at: '2026-09-20 02:00:01' });
const response = (runs, next_offset = null) => Response.json({ runs, next_offset });
test('recorded capture labels require both the capture source and replay mode', () => {
  const capture = { ...run(), edge_id: 'grp6-recorded-capture', mode: 'replay' };
  assert.equal(isRecordedCapture(capture), true);
  assert.equal(storedRunSourceLabel(capture), 'RECORDED · GEMINI CAPTURE');
  assert.equal(isRecordedCapture({ ...capture, mode: 'live' }), false);
  assert.equal(isRecordedCapture(run('a', 'b', 'replay')), false);
  assert.ok(zhTW[storedRunSourceLabel(capture)]);
});
test('host capture names require the exact run, tester, live mode and relay source', () => {
  for (const [id, name] of [
    ['04dcb07358ee4f3da41e5cbc12cb9850', 'Gemini run'],
    ['3f46468325ac47de894e6a13d3c672e0', 'Gemini run'],
  ]) {
    const capture = { ...run('group-6', id), edge_id: 'grp6-hc-relay' };
    assert.equal(storedRunName(capture), name);
    assert.equal(storedRunSourceLabel(capture), 'STORED · LIVE-SOURCE RECORDS');
    for (const change of [{ tester_id: 'other' }, { edge_id: 'other' }, { mode: 'replay' }, { mode: 'simulation' }]) {
      assert.equal(storedRunName({ ...capture, ...change }), null);
    }
  }
  assert.equal(runModeLabel('live'), 'STORED · LIVE-SOURCE RECORDS');
});

test('training identity preserves the existing exact three-field match and recorded names', () => {
  const training = { ...run('grp6-replay', 'grp6-replay-demo', 'replay'), edge_id: 'grp6-replay-exporter' };
  for (const mode of ['live', 'replay', 'simulation']) {
    assert.equal(isTrainingReplay({ ...training, mode }), true);
    assert.equal(storedRunName({ ...training, mode }), 'Training-data replay');
  }
  for (const field of ['edge_id', 'tester_id', 'run_id']) {
    const other = { ...training, [field]: `${training[field]}-other` };
    assert.equal(isTrainingReplay(other), false);
    assert.equal(storedRunName(other), null);
  }
  for (const [id, name] of [['ae20cd5ae29d47af87163265205ffced', 'Engineering check'], ['d132133657be459e8e97b6fd442142e2', 'Production run 3']]) {
    assert.equal(storedRunName({ ...run('group-6', id, 'replay'), edge_id: 'grp6-recorded-capture' }), name);
  }
});

function harness(fetcher, filter) {
  let state = initialRunDiscovery();
  const updates = [];
  const controller = createRunDiscovery(fetcher, value => { state = value; updates.push(value); }, filter);
  return { controller, updates, get state() { return state; } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('discovery chooses exact tester/run pairs without selecting or loading the first result', async () => {
  const calls = [];
  const h = harness(async (url, options) => { calls.push(url); assert.equal(options.cache, 'no-store'); return response([run(), run('b', 'shared', 'replay')]); });
  await h.controller.refresh();
  assert.equal(h.state.selected, '');
  assert.equal(selectedStoredRun(h.state), undefined);
  h.controller.select(runChoiceKey(run('b')));
  assert.equal(selectedStoredRun(h.state).tester_id, 'b');
  assert.equal(selectedStoredRun(h.state).mode, 'replay');
  assert.deepEqual(calls, ['/api/v1/runs?limit=100&offset=0']);
  h.controller.select('fabricated');
  assert.equal(selectedStoredRun(h.state), undefined);
  assert.notEqual(runChoiceKey(run('a/b', 'c')), runChoiceKey(run('a', 'b/c')));
});

test('refresh preserves valid choice, clears a removed choice, and never substitutes another run', async () => {
  let rows = [run(), run('b')];
  const h = harness(async () => response(rows));
  await h.controller.refresh();
  h.controller.select(runChoiceKey(run('b')));
  rows = [run('c'), run('b')];
  await h.controller.refresh();
  assert.equal(selectedStoredRun(h.state).tester_id, 'b');
  rows = [run('c')];
  await h.controller.refresh();
  assert.equal(h.state.selected, '');
  rows = [];
  await h.controller.refresh();
  assert.equal(h.state.loaded, true);
  assert.equal(h.state.error, false);
  assert.deepEqual(h.state.runs, []);
});

test('failure retains the last list and draft; a successful retry clears the error', async () => {
  let result = () => response([run()]);
  const h = harness(async () => result());
  await h.controller.refresh();
  h.controller.select(runChoiceKey(run()));
  for (const failure of [() => new Response('offline', { status: 503 }), () => Response.json({ runs: [run()], next_offset: 'bad' }), () => { throw Error('offline'); }]) {
    result = failure;
    await h.controller.refresh();
    assert.equal(h.state.error, true);
    assert.equal(h.state.loading, false);
    assert.equal(selectedStoredRun(h.state).tester_id, 'a');
  }
  result = () => response([run()]);
  await h.controller.refresh();
  assert.equal(h.state.error, false);
});

test('a slow superseded response or disposed request cannot overwrite current discovery', async () => {
  const first = deferred(), second = deferred(), third = deferred();
  const pending = [first, second, third], signals = [];
  const h = harness((_url, options) => { signals.push(options.signal); return pending.shift().promise; });
  const a = h.controller.refresh(), b = h.controller.refresh();
  assert.equal(signals[0].aborted, true);
  second.resolve(response([run('new')])); await b;
  first.resolve(response([run('old')])); await a;
  assert.equal(h.state.runs[0].tester_id, 'new');
  const c = h.controller.refresh(), count = h.updates.length;
  h.controller.dispose();
  third.resolve(response([])); await c;
  assert.equal(signals[2].aborted, true);
  assert.equal(h.updates.length, count);
});

test('more pages deduplicate pairs, retain draft choice and reject nonadvancing pagination', async () => {
  const replies = [response([run()], 1), response([run(), run('b')], 2), response([run('c')], 2)];
  const urls = [];
  const h = harness(async url => { urls.push(url); return replies.shift(); });
  await h.controller.refresh(); h.controller.select(runChoiceKey(run()));
  await h.controller.more();
  assert.equal(h.state.runs.length, 2);
  assert.equal(selectedStoredRun(h.state).tester_id, 'a');
  await h.controller.more();
  assert.equal(h.state.error, true);
  assert.equal(h.state.runs.length, 2);
  assert.deepEqual(urls.map(url => new URL(url, 'https://test').searchParams.get('offset')), ['0', '1', '2']);
});

test('filter preserves server pagination across empty and mixed pages, deduplication and selection', async () => {
  const training = { ...run('grp6-replay', 'grp6-replay-demo', 'replay'), edge_id: 'grp6-replay-exporter' };
  const updated = { ...run(), updated_at: '2026-09-20 03:00:00' };
  const replies = [response([training], 100), response([training, run()], 200), response([training], 300), response([updated, run('b')]), response([training])];
  const offsets = [];
  const h = harness(async url => {
    offsets.push(new URL(url, 'https://test').searchParams.get('offset'));
    return replies.shift();
  }, entry => !isTrainingReplay(entry));
  await h.controller.refresh();
  assert.deepEqual(h.state.runs, []);
  assert.equal(h.state.loaded, true);
  assert.equal(h.state.error, false);
  assert.equal(h.state.nextOffset, 100);
  h.controller.select(runChoiceKey(training));
  assert.equal(h.state.selected, '');
  await h.controller.more();
  assert.deepEqual(h.state.runs, [run()]);
  h.controller.select(runChoiceKey(run()));
  await h.controller.more();
  assert.deepEqual(h.state.runs, [run()]);
  assert.equal(h.state.nextOffset, 300);
  assert.equal(selectedStoredRun(h.state).tester_id, 'a');
  await h.controller.more();
  assert.deepEqual(h.state.runs, [updated, run('b')]);
  assert.deepEqual(selectedStoredRun(h.state), updated);
  assert.equal(h.state.nextOffset, null);
  await h.controller.more();
  assert.deepEqual(offsets, ['0', '100', '200', '300']);
  await h.controller.refresh();
  assert.deepEqual(h.state.runs, []);
  assert.equal(h.state.selected, '');
  assert.deepEqual(offsets, ['0', '100', '200', '300', '0']);
});

test('default discovery retains all modes including training replay', async () => {
  const rows = ['live', 'replay', 'simulation'].map(mode => run('a', mode, mode));
  rows.push({ ...run('grp6-replay', 'grp6-replay-demo', 'replay'), edge_id: 'grp6-replay-exporter' });
  const h = harness(async () => response(rows));
  await h.controller.refresh();
  assert.deepEqual(h.state.runs, rows);
});

test('discovery and draft changes preserve imported summary until explicit source Load', async () => {
  const values = new Map();
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const data = JSON.parse(readFileSync(new URL('../public/replay/summary.json', import.meta.url), 'utf8'));
  const replay = { data, filename: 'saved.json', selection: { waferId: '3', alertIndex: 0, filter: 'alert', tab: 'analysis', detailOpen: true } };
  writeSourceSession({ version: 1, mode: 'summary', replay });
  const savedReplay = readSourceSession().replay;
  const before = [...values];
  const h = harness(async () => response([run()]));
  await h.controller.refresh(); h.controller.select(runChoiceKey(run())); await h.controller.refresh();
  assert.deepEqual([...values], before);
  assert.equal(readSourceSession().mode, 'summary');
  selectBackendSource();
  assert.equal(readSourceSession().mode, 'backend');
  assert.deepEqual(readSourceSession().replay, savedReplay);
  delete globalThis.sessionStorage;
});

test('picker copy and every source-mode label have bundled Traditional Chinese translations', () => {
  const component = readFileSync(new URL('../components/stored-run-picker.tsx', import.meta.url), 'utf8');
  const strings = [...component.matchAll(/t[(]'([^']+)'/g)];
  assert.ok(strings.length > 10);
  for (const match of strings) assert.ok(zhTW[match[1]], match[1]);
  for (const mode of ['live', 'replay', 'simulation']) assert.ok(zhTW[runModeLabel(mode)], mode);
});

 test('new host relay runs have a Gemini name and retired probes stay out of both pickers', async () => {
  const fresh = { ...run('group-6', 'fresh'), edge_id: 'grp6-hc-relay' };
  assert.equal(storedRunName(fresh), 'Gemini run');
  const retired = ['4620bc260aef42329930bbf46d35b13f', '74c4e8ccd7f446d3bfcdf2ab7b668f6d', '80727b22581b44579471eebfb2ef4a5e'].map(run_id => ({ ...fresh, run_id }));
  const otherTester = { ...retired[0], tester_id: 'other' };
  const h = harness(async () => response([...retired, fresh, otherTester]));
  await h.controller.refresh();
  assert.deepEqual(h.state.runs, [fresh, otherTester]);
 });
