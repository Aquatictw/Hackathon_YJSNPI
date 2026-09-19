import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunDiscovery, initialRunDiscovery, runChoiceKey, runModeLabel, selectedStoredRun } from '../lib/rtdi/run-discovery.ts';
import { readSourceSession, writeSourceSession, selectBackendSource } from '../lib/rtdi/source-session.ts';
import { zhTW } from '../lib/rtdi/locale-zh-TW.ts';

const run = (tester = 'a', id = 'shared', mode = 'live') => ({ tester_id: tester, run_id: id, mode, edge_id: 'edge', last_event_at: '2026-09-20T02:00:00Z', updated_at: '2026-09-20 02:00:01' });
const response = (runs, next_offset = null) => Response.json({ runs, next_offset });
function harness(fetcher) {
  let state = initialRunDiscovery();
  const updates = [];
  const controller = createRunDiscovery(fetcher, value => { state = value; updates.push(value); });
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
