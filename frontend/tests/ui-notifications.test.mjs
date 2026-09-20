import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import * as notifications from '../lib/rtdi/ui-notifications.ts';
import {createDashboardLifecycle} from '../lib/rtdi/ui-lifecycle.ts';

const timestamp = '2026-09-19T00:00:00Z';
const prediction = (id, fields = {}) => ({event_id: id, type: 'prediction', run_id: 'r', tester_id: 't', source_mode: 'live', timestamp,
  request_id: id, device_id: 'd', stage: 1, prediction: 25, ...fields});
const incident = id => ({incident_id: id, title: 'Source incident', status: 'open', severity: 'warning', first_seen: timestamp, last_seen: timestamp});
const evidence = (id, fields = {}) => ({event_id: 'e-' + id, evidence_id: 'ev-' + id, incident_id: id, type: 'evidence',
  run_id: 'r', tester_id: 't', source_mode: 'live', timestamp, ...fields});
const snapshot = (events = [], incidents = [], supplied = []) => ({
  run: {run_id: 'r', tester_id: 't', edge_id: 'e', mode: 'live', lot_id: null, wafer_id: 'DO-NOT-INFER', data_quality: 'partial', last_event_at: timestamp},
  events, incidents, evidence: supplied, commands: [],
});
function tracker() {
  let items = []; const callbacks = new Set();
  const controller = notifications.createRunNotifications(value => {items = value;}, callback => {
    callbacks.add(callback); return () => callbacks.delete(callback);
  });
  return {controller, items: () => items, flush() {for (const callback of [...callbacks]) {callbacks.delete(callback); callback();}}, callbacks};
}

test('history, duplicate snapshots, actual joins, and non-prediction records never notify', () => {
  const h = tracker(), old = prediction('old');
  h.controller.accept(snapshot([old], [incident('old')]), false);
  h.controller.accept(snapshot([old], [incident('old')]), true);
  h.controller.accept(snapshot([{...old, actual: 25}, prediction('missing', {prediction: null}), prediction('actual', {type: 'prediction_actual'})], [incident('old')]), true);
  h.flush(); assert.deepEqual(h.items(), []);
  // Arrival follows ingestion identity, even when original source timestamps are old.
  h.controller.accept(snapshot([old, prediction('new')], [incident('old')]), true);
  h.flush(); assert.equal(h.items()[0].count, 1);
  h.controller.dismiss(h.items()[0].id);
  h.controller.accept(snapshot([old, prediction('new')], [incident('old')]), true);
  h.flush(); assert.deepEqual(h.items(), []);
});

test('temperature bursts share one throttled popup; incidents appear immediately with priority and cap', () => {
  const h = tracker(); h.controller.accept(snapshot(), false);
  const events = Array.from({length: 120}, (_, i) => prediction('p' + i, {wafer_id: '02', site_id: i % 4 + 1}));
  h.controller.accept(snapshot(events.slice(0, 60)), true);
  h.controller.accept(snapshot(events), true);
  assert.equal(h.callbacks.size, 1); assert.deepEqual(h.items(), []);
  h.controller.accept(snapshot(events, [incident('i1')], [evidence('i1', {wafer_id: '02', site_ids: [4, 2]})]), true);
  assert.equal(h.items()[0].kind, 'incident');
  assert.equal(h.items()[0].incidentId, 'i1');
  assert.deepEqual(h.items()[0].locations, [{wafer: '02', sites: [2, 4]}]);
  h.flush(); assert.equal(h.items()[1].count, 120);
  for (let i = 2; i <= 5; i++) h.controller.accept(snapshot(events, Array.from({length: i}, (_, j) => incident('i' + (j + 1)))), true);
  assert.equal(h.items().length, 3); assert.ok(h.items().every(item => item.kind === 'incident'));
  h.controller.dismiss(h.items()[0].id); assert.equal(h.items().length, 2);
});

test('reset cancels delayed arrivals and establishes a fresh navigation/reconnect baseline', () => {
  const h = tracker(); h.controller.accept(snapshot(), false);
  h.controller.accept(snapshot([prediction('pending')]), true);
  h.controller.reset(); h.flush(); assert.deepEqual(h.items(), []);
  h.controller.accept(snapshot([prediction('pending')], [incident('gap')]), true);
  h.flush(); assert.deepEqual(h.items(), []);
  h.controller.accept(snapshot([prediction('pending'), prediction('fresh')], [incident('gap')]), true);
  h.flush(); assert.equal(h.items()[0].count, 1);
});

test('actual event fields supply concise bilingual labels; absent IDs stay unknown', () => {
  const h = tracker(); h.controller.accept(snapshot(), false);
  h.controller.accept(snapshot([], [incident('unknown')]), true);
  const item = h.items()[0];
  assert.equal(notifications.notificationCopy(item, 'en').detail, 'Wafer unknown · Site unknown');
  assert.equal(notifications.notificationCopy(item, 'zh-TW').detail, '晶圓未知 · 站點未知');
  assert.equal(notifications.notificationCopy(item, 'zh-TW').title, '1 筆新異常事件');
  assert.ok(!JSON.stringify(item).includes('DO-NOT-INFER'));
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function lifecycleHarness() {
  const requests = [], streams = [];
  const controller = createDashboardLifecycle({fetch() {return new Promise(resolve => requests.push((data, ok = true) => resolve({ok, status: ok ? 200 : 503, json: async () => data})));},
    eventSource() {const handlers = new Map(); const stream = {onerror: null, addEventListener(name, fn) {handlers.set(name, fn);}, close() {}, emit(name) {name === 'error' ? this.onerror?.() : handlers.get(name)?.();}}; streams.push(stream); return stream;}
  }, () => {});
  return {controller, streams, requests, async respond(data, ok) {requests.shift()(data, ok); await tick();},
    async load(data = snapshot()) {const pending = controller.connect('r', 't'); await this.respond(data); await pending;},
    async update(data, name = 'edge_event') {streams.at(-1).emit(name); await this.respond(data);},
    items() {return controller.getState().notifications;}};
}

test('real lifecycle suppresses initial/ready history and unlimited SSE backlog, then reports new incident once', async () => {
  const h = lifecycleHarness(); const history = snapshot([prediction('old')], [incident('old')]);
  await h.load(history); await h.update(history, 'ready');
  for (let i = 0; i < 12; i++) await h.update(history);
  assert.deepEqual(h.items(), []);
  const fresh = snapshot(history.events, [...history.incidents, incident('fresh')]);
  await h.update(fresh); assert.equal(h.items()[0].count, 1);
  h.controller.dismissNotification(h.items()[0].id);
  await h.update(fresh, 'heartbeat'); assert.deepEqual(h.items(), []);
  h.controller.dispose();
});

test('reconnect races, snapshot failures and navigation cannot replay gap arrivals', async () => {
  const h = lifecycleHarness(); await h.load(); await h.update(snapshot(), 'ready');
  const stream = h.streams[0]; stream.emit('edge_event');
  stream.emit('error'); stream.emit('ready');
  const gap = snapshot([], [incident('gap')]);
  await h.respond(gap); // Old in-flight response must not establish the new epoch baseline.
  const recovered = snapshot([], [incident('gap'), incident('recovery')]);
  await h.respond(recovered); assert.deepEqual(h.items(), []);
  const fresh = snapshot([], [...recovered.incidents, incident('fresh')]);
  await h.update(fresh); assert.equal(h.items().length, 1);
  await h.update({error: 'offline'});
  // Invalid snapshot re-baselines the next successful response.
  await h.update(snapshot([], [...fresh.incidents, incident('failed-gap')])); assert.deepEqual(h.items(), []);
  await h.load(fresh); await h.update(fresh, 'ready'); assert.deepEqual(h.items(), []);
  h.controller.disconnect(); stream.emit('edge_event'); assert.equal(h.requests.length, 0);
  h.controller.dispose();
  const nextPage = lifecycleHarness(); await nextPage.load(fresh); await nextPage.update(fresh, 'ready');
  assert.deepEqual(nextPage.items(), []); nextPage.controller.dispose();
});

test('disposal cancels a throttled temperature publication', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const h = lifecycleHarness(); await h.load(); await h.update(snapshot(), 'ready');
  await h.update(snapshot([prediction('fresh')]));
  h.controller.dispose(); const before = h.controller.getState();
  t.mock.timers.tick(3000); assert.equal(h.controller.getState(), before);
});

test('real lifecycle batches temperatures for two seconds and clears pending updates on scope change', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const h = lifecycleHarness(); await h.load(); await h.update(snapshot(), 'ready');
  await h.update(snapshot([prediction('one')]));
  await h.update(snapshot([prediction('one'), prediction('two')]));
  t.mock.timers.tick(1999); assert.deepEqual(h.items(), []);
  t.mock.timers.tick(1); assert.equal(h.items()[0].count, 2);
  await h.update(snapshot([prediction('one'), prediction('two'), prediction('pending')]));
  const pending = h.controller.connect('different', 't');
  await h.respond({error: 'missing'}, false); await pending;
  t.mock.timers.tick(2000); assert.deepEqual(h.items(), []); h.controller.dispose();
});

test('component uses current locale, polite announcements and a working accessible dismiss button', () => {
  const source = readFileSync(new URL('../components/run-notifications.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS}}).outputText;
  let locale = 'en', dismissed, opened;
  const context = {exports: {}, require(id) {
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === '@/components/locale-provider') return {useLocale: () => ({locale})};
    if (id === '@/lib/rtdi/ui-notifications') return notifications;
    if (id === 'lucide-react') return {TriangleAlert: 'AlertIcon', Thermometer: 'TemperatureIcon', X: 'CloseIcon'};
    if (id.endsWith('.css')) return {};
    throw Error(id);
  }}; vm.runInNewContext(code, context);
  const props = {items: [{id: 7, kind: 'incident', count: 1, incidentId: 'i7', locations: [{wafer: null, sites: []}]}], scope: {run: 'r', tester: 't'}, onOpen: item => {opened = item;}, onDismiss: id => {dismissed = id;}};
  let tree = context.exports.RunNotifications(props);
  assert.equal(tree.props.children.props.role, 'status');
  let card = tree.props.children.props.children[0];
  assert.equal(card.props.children[1].type, 'a');
  assert.equal(card.props.children[1].props.href, '/workspace?run=r&tester=t&tab=evidence&incident=i7#batch-panel');
  let prevented = false;
  card.props.children[1].props.onClick({button: 0, preventDefault() {prevented = true;}});
  assert.equal(prevented, true); assert.equal(opened.incidentId, 'i7');
  opened = undefined;
  card.props.children[1].props.onClick({button: 0, ctrlKey: true, preventDefault() {throw Error('Keep modified navigation native');}});
  assert.equal(opened, undefined);
  assert.match(card.props.children[2].props['aria-label'], /Dismiss notification/);
  card.props.children[2].props.onClick(); assert.equal(dismissed, 7);
  assert.equal(opened, undefined);
  locale = 'zh-TW'; tree = context.exports.RunNotifications(props); card = tree.props.children.props.children[0];
  assert.equal(card.props.children[1].props.children[0].props.children, '1 筆新異常事件');
  assert.match(card.props.children[2].props['aria-label'], /關閉通知/);
  const css = readFileSync(new URL('../components/run-notifications.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce/); assert.match(css, /focus-visible/);
});

test('notification links preserve encoded run scope and route temperatures to their tab', () => {
  const scope = {run: 'run / &', tester: 'tester #1'};
  const item = {id: 1, kind: 'temperature', count: 8, locations: []};
  const url = new URL(notifications.notificationHref(item, scope), 'https://example.test');
  assert.equal(url.pathname, '/workspace');
  assert.equal(url.searchParams.get('run'), scope.run);
  assert.equal(url.searchParams.get('tester'), scope.tester);
  assert.equal(url.searchParams.get('tab'), 'predictions');
  assert.equal(url.searchParams.has('incident'), false);
});
