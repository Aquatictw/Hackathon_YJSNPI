import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as discovery from '../lib/rtdi/run-discovery.ts';
import * as conversations from '../lib/rtdi/ui-conversations.ts';
import {translate} from '../lib/rtdi/locale.ts';

const row = (run_id = 'chosen', fields = {}) => ({run_id, tester_id: 'group-6', edge_id: 'grp6-hc-relay', mode: 'live', archived: false, finished: true,
  last_event_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20 00:00:00', ...fields});
const list = runs => Response.json({runs, next_offset: null});
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
function harness(fetcher) {
  let state; const controller = discovery.createRunDiscovery(fetcher, value => {state = value;});
  return {controller, state: () => state, async choose(run = row()) {await controller.refresh(); controller.select(discovery.runChoiceKey(run));}};
}

test('category uses archived flag while source mode and Gemini name stay intact', () => {
  const archived = row('archived', {archived: true});
  assert.equal(discovery.storedRunCategory(archived), 'replay');
  assert.equal(discovery.storedRunName(archived), 'Gemini run');
  assert.equal(discovery.storedRunSourceLabel(archived), 'STORED · LIVE-SOURCE RECORDS');
  assert.equal(discovery.storedRunCategory(row()), 'live');
  for (const mode of ['replay', 'simulation']) assert.equal(discovery.storedRunCategory(row('r', {mode})), 'replay');
  const old = row(); delete old.finished; delete old.archived;
  assert.equal(discovery.storedRunSchema.parse(old).finished, false);
});

test('archive posts exact dropdown identity, serializes actions, refreshes and preserves source mode', async () => {
  const target = row('run / 中文'), pending = deferred(), requests = []; let rows = [target, row('other')];
  const h = harness(async (url, options) => {requests.push({url, options}); return options.method ? pending.promise : list(rows);});
  await h.choose(target); const operation = h.controller.manage('archive', () => assert.fail('archive must not clear loaded scope'));
  assert.equal(h.state().managing, true);
  h.controller.select(discovery.runChoiceKey(row('other'))); await h.controller.refresh();
  assert.equal(await h.controller.manage('delete', () => {}), false);
  assert.equal(h.state().selected, discovery.runChoiceKey(target));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/v1/runs/' + encodeURIComponent(target.run_id) + '/manage');
  assert.equal(requests[1].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(requests[1].options.body), {tester_id: target.tester_id, action: 'archive'});
  rows = [{...target, archived: true}, row('other')]; pending.resolve(Response.json({ok: true})); await operation;
  assert.equal(requests.length, 3); assert.equal(h.state().managing, false);
  assert.equal(discovery.selectedStoredRun(h.state()).mode, 'live');
  assert.equal(discovery.storedRunCategory(discovery.selectedStoredRun(h.state())), 'replay');
});

test('unfinished and Replay choices cannot archive; empty/loading selections cannot mutate', async () => {
  for (const fields of [{finished: false}, {archived: true}, {mode: 'replay'}, {mode: 'simulation'}]) {
    let posts = 0; const target = row('r', fields);
    const h = harness(async (_, options) => {if (options.method) posts++; return list([target]);});
    assert.equal(await h.controller.manage('delete', () => {}), false);
    await h.choose(target); assert.equal(await h.controller.manage('archive', () => {}), false); assert.equal(posts, 0);
  }
});

test('delete clears only exact chosen tester/run, notifies once, and keeps list deletion after refresh failure', async () => {
  let gets = 0; const deleted = [], target = row(), other = row('chosen', {tester_id: 'another tester'});
  const h = harness(async (_, options) => options.method ? Response.json({ok: true}) : ++gets === 1 ? list([target, other]) : Response.json({}, {status: 503}));
  await h.choose(); assert.equal(await h.controller.manage('delete', scope => deleted.push(scope)), true);
  assert.deepEqual(deleted, [{run: 'chosen', tester: 'group-6'}]);
  assert.deepEqual(h.state().runs, [other]); assert.equal(h.state().selected, ''); assert.equal(h.state().error, true);
});

test('failed or malformed mutation does not clear selection/session; retry succeeds', async () => {
  for (const response of [Response.json({error: 'unfinished'}, {status: 409}), Response.json({ok: false})]) {
    let fail = true, deleted = 0;
    const h = harness(async (_, options) => options.method ? fail ? response : Response.json({ok: true}) : list(fail ? [row()] : []));
    await h.choose(); assert.equal(await h.controller.manage('delete', () => deleted++), false);
    assert.equal(deleted, 0); assert.equal(h.state().selected, discovery.runChoiceKey(row()));
    assert.ok(h.state().managementError); assert.equal(h.state().managing, false);
    fail = false; await h.controller.manage('delete', () => deleted++); assert.equal(deleted, 1); assert.equal(h.state().managementError, '');
  }
});

test('late successful deletion still cleans saved scope after unmount without publishing or refreshing', async () => {
  const pending = deferred(), deleted = []; let requests = 0;
  const h = harness(async (_, options) => {requests++; return options.method ? pending.promise : list([row()]);});
  await h.choose(); const operation = h.controller.manage('delete', scope => deleted.push(scope));
  h.controller.dispose(); const state = h.state(); pending.resolve(Response.json({ok: true})); await operation;
  assert.equal(h.state(), state); assert.equal(requests, 2); assert.deepEqual(deleted, [{run: 'chosen', tester: 'group-6'}]);
});

const source = readFileSync(new URL('../components/stored-run-picker.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
function mount(rows = [row()], initialProps = {}) {
  const saved = new Map(), storage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)};
  let props, cursor = 0, locale = 'en', tree, confirmed = true; const slots = [], effects = [], requests = [], confirms = [], deleted = [], loaded = [];
  const state = initial => {const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => {slots[index] = typeof value === 'function' ? value(slots[index]) : value;}];};
  const hooks = {...React, useState: state, useRef: initial => state(() => ({current: initial}))[0], useId: () => 'picker',
    useEffect(fn, deps) {const index = cursor++, prior = slots[index]; if (!prior || deps.some((value, i) => value !== prior.deps[i])) {
      prior?.cleanup?.(); const slot = {deps}; slots[index] = slot; effects.push(() => {slot.cleanup = fn();});
    }}
  };
  const context = {exports: {}, fetch: async (url, options) => {requests.push({url, options}); if (!options.method) return list(rows);
    const body = JSON.parse(options.body); rows = body.action === 'delete' ? rows.filter(value => value.run_id !== decodeURIComponent(url.split('/')[4]) || value.tester_id !== body.tester_id)
      : rows.map(value => value.run_id === decodeURIComponent(url.split('/')[4]) && value.tester_id === body.tester_id ? {...value, archived: true} : value);
    return Response.json({ok: true});
  }, window: {sessionStorage: storage, confirm(message) {confirms.push(message); return confirmed;}}, require(id) {
    if (id === 'react') return hooks; if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === '@/components/locale-provider') return {useLocale: () => ({locale, t: (key, ...args) => translate(locale, key, ...args)})};
    if (id === '@/lib/rtdi/run-discovery') return discovery;
    if (id === '@/lib/rtdi/ui-conversations') return conversations;
    if (id === 'lucide-react') return new Proxy({}, {get: (_, key) => key});
    if (id.endsWith('.css')) return {}; throw Error(id);
  }};
  vm.runInNewContext(code, context);
  props = {onLoad: (...scope) => loaded.push(scope), onDeleted: scope => deleted.push(scope), onLoadSummary() {}, ...initialProps};
  function render() {cursor = 0; tree = context.exports.StoredRunPicker(props); while (effects.length) effects.shift()(); return tree;}
  function nodes(value = tree) {if (Array.isArray(value)) return value.flatMap(child => nodes(child ?? null)); if (!value || typeof value !== 'object') return []; return [value, ...nodes(value.props?.children ?? null)];}
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
  const button = label => nodes().find(value => value.type === 'button' && text(value) === label);
  render();
  return {render, nodes, button, confirms, deleted, loaded, requests, storage, async settle() {await tick(); render();},
    select(value) {nodes().find(value => value.type === 'select').props.onChange({target: {value}}); render();},
    props(next) {props = {...props, ...next}; render();}, locale(value) {locale = value; render();}, confirm(value) {confirmed = value;},
  };
}

test('picker disables management for no choice, manual/summary/busy and unfinished Replay choices', async () => {
  const h = mount([row(), row('pending', {finished: false}), row('archived', {archived: true})]); await h.settle();
  assert.equal(h.button('Remove').props.disabled, true);
  h.select(discovery.runChoiceKey(row())); assert.equal(h.button('Move to Replay').props.disabled, false);
  for (const props of [{busy: true}]) {
    h.props(props); assert.equal(h.button('Remove').props.disabled, true); assert.equal(h.button('Move to Replay').props.disabled, true);
    h.props({busy: false, imported: false, onDeleted() {}});
  }
  h.select('__summary__'); assert.equal(h.button('Remove').props.disabled, true);
  h.select(discovery.runChoiceKey(row())); h.button('Enter IDs manually').props.onClick(); h.render();
  assert.equal(h.button('Remove').props.disabled, true); h.button('Choose from stored runs').props.onClick(); h.render();
  for (const id of ['pending', 'archived']) {h.select(discovery.runChoiceKey(row(id))); assert.equal(h.button('Move to Replay').props.disabled, true); assert.equal(h.button('Remove').props.disabled, false);}
});

test('Remove confirmation names exact dropdown scope and permanence; cancel sends no POST, bilingual confirm deletes', async () => {
  const h = mount([row('loaded-elsewhere'), row('chosen')]); await h.settle(); h.select(discovery.runChoiceKey(row()));
  h.confirm(false); h.button('Remove').props.onClick(); await h.settle();
  assert.match(h.confirms[0], /Permanently delete/); assert.match(h.confirms[0], /Run ID: chosen/); assert.match(h.confirms[0], /Tester ID: group-6/);
  assert.equal(h.requests.filter(request => request.options.method).length, 0);
  h.locale('zh-TW'); h.confirm(true); h.button('移除').props.onClick(); await h.settle();
  assert.match(h.confirms[1], /永久刪除/); assert.match(h.confirms[1], /chosen/); assert.match(h.confirms[1], /group-6/);
  assert.deepEqual(h.deleted, [{run: 'chosen', tester: 'group-6'}]); assert.deepEqual(h.loaded, []);
  assert.equal(h.button('移除').props.disabled, true);
});

test('both offline picker modes manage backend choices and forget only the deleted persisted scope', async () => {
  for (const props of [{imported: true}, {summarySelected: true}]) {
    const h = mount([row()], {...props, onDeleted: undefined}); await h.settle();
    assert.equal(h.button('Remove').props.disabled, true);
    h.select(discovery.runChoiceKey(row()));
    assert.equal(h.button('Remove').props.disabled, false);
    assert.equal(h.button('Move to Replay').props.disabled, false);
    const target = {run: 'chosen', tester: 'group-6'}, other = {run: 'chosen', tester: 'other-tester'};
    const cache = conversations.createConversationCache(h.storage);
    const draft = {messages: [], question: 'retained draft'};
    cache.write(other, ['run', ''], draft, 'other-event');
    cache.write(target, ['run', ''], draft, 'target-event');
    const summarySession = JSON.stringify({version: 1, mode: 'summary', replayView: 'imported', replay: {filename: 'summary.json'}});
    h.storage.setItem('rtdi.source-session.v1', summarySession);
    h.button('Remove').props.onClick(); await h.settle();
    const restored = conversations.createConversationCache(h.storage);
    assert.equal(restored.lastScope(), null);
    assert.equal(restored.selected(target), '');
    assert.equal(restored.read(target, ['run', '']).question, '');
    assert.equal(restored.selected(other), 'other-event');
    assert.deepEqual(restored.read(other, ['run', '']), draft);
    assert.equal(h.storage.getItem('rtdi.source-session.v1'), summarySession);
    assert.deepEqual(h.loaded, []);
    h.select('__summary__');
    assert.equal(h.button('Remove').props.disabled, true);
    assert.equal(h.button('Move to Replay').props.disabled, true);
  }
});

test('offline picker can archive without a loaded backend controller and preserves its saved scope', async () => {
  const h = mount([row()], {imported: true, onDeleted: undefined}); await h.settle();
  const scope = {run: 'chosen', tester: 'group-6'};
  conversations.createConversationCache(h.storage).write(scope, ['run', ''], {messages: [], question: 'keep'}, 'event');
  const before = h.storage.getItem(conversations.CONVERSATION_SESSION_KEY);
  h.select(discovery.runChoiceKey(row())); h.button('Move to Replay').props.onClick(); await h.settle();
  assert.equal(h.button('Move to Replay').props.disabled, true);
  assert.equal(h.button('Remove').props.disabled, false);
  assert.equal(h.storage.getItem(conversations.CONVERSATION_SESSION_KEY), before);
  assert.deepEqual(h.loaded, []);
});

test('Move to Replay moves the selected Gemini option into Replay without implicitly loading it', async () => {
  const h = mount(); await h.settle(); h.select(discovery.runChoiceKey(row())); h.button('Move to Replay').props.onClick(); await h.settle();
  const groups = h.nodes().filter(value => value.type === 'optgroup');
  const replay = groups.find(value => value.props.label === 'Replay');
  const options = h.nodes(replay).filter(value => value.type === 'option');
  assert.ok(options.some(value => value.props.value === discovery.runChoiceKey(row())));
  assert.match(JSON.stringify(options), /Gemini run/); assert.equal(h.button('Move to Replay').props.disabled, true);
  assert.deepEqual(h.loaded, []); assert.deepEqual(h.deleted, []);
});
