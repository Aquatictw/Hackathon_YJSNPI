import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as wafers from '../lib/rtdi/analysis-wafers.ts';
import * as analysis from '../lib/rtdi/run-analysis.ts';
import {parseSnapshot} from '../lib/rtdi/dashboard.ts';
import {initialDashboardState} from '../lib/rtdi/ui-lifecycle.ts';

const timestamp = '2026-09-20T09:00:00Z';
function event(id, wafer, fields = {}) {
  return {event_id: id, type: 'heartbeat', run_id: 'r', tester_id: 't',
    source_mode: 'replay', timestamp, lot_id: 'L', ...(wafer === null ? {} : {wafer_id: wafer}), ...fields};
}
const summary = (id, wafer) => event(id, wafer, {type: 'run_summary', yield: 0, completed_devices: 0});
function snapshot(events, run = {}) {
  return parseSnapshot({run: {run_id: 'r', tester_id: 't', edge_id: 'edge', mode: 'replay',
    lot_id: 'L', wafer_id: null, last_event_at: timestamp, data_quality: 'partial', ...run},
    events, evidence: [], incidents: [], commands: []}, run.run_id ?? 'r', 't');
}
const source = readFileSync(new URL('../components/run-analysis.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;

// Exercise the real component, effects and click handlers without browser or transport.
function mount() {
  const slots = [], effects = []; let cursor = 0, dirty = false, publish;
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }];
  };
  const changed = (prior, deps) => !prior || deps.some((item, index) => !Object.is(item, prior.deps[index]));
  const hooks = {...React, useState, useRef: initial => useState(() => ({current: initial}))[0],
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index], deps)) slots[index] = {deps, value: fn()}; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (changed(slots[index], deps)) { slots[index]?.cleanup?.(); const slot = {deps}; slots[index] = slot; effects.push(() => {slot.cleanup = fn();}); } },
  };
  const symbols = new Proxy({}, {get: (_, key) => key});
  const context = {exports: {}, require(id) {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === '@/components/locale-provider') return {useLocale: () => ({t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, index) => args[index]), locale: 'en'})};
    if (id === '@/lib/rtdi/analysis-wafers') return wafers;
    if (id === '@/lib/rtdi/run-analysis') return analysis;
    if (id === '@/lib/rtdi/ui-lifecycle') return {initialDashboardState, createDashboardLifecycle: (_, listener) => {publish = listener; return {restoreSession() {}, dispose() {}};}};
    if (id.endsWith('.css')) return {};
    if (id === 'lucide-react' || id.startsWith('@/components/')) return symbols;
    throw Error('Unexpected dependency ' + id);
  }};
  vm.runInNewContext(code, context);
  function render() {
    let tree, passes = 0;
    do {
      assert.ok(++passes < 10, 'selection effects must settle'); dirty = false; cursor = 0;
      tree = context.exports.RunAnalysis(); while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  }
  render();
  return {render, update(data) {publish({...initialDashboardState, data, scope: {run: data.run.run_id, tester: 't'}}); return render();}};
}
function find(node, predicate) {
  if (Array.isArray(node)) {for (const child of node) {const result = find(child, predicate); if (result) return result;} return;}
  if (!node || typeof node !== 'object') return;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const tile = (tree, id) => find(tree, node => node.type === 'button' && node.key === JSON.stringify(['L', id]));
const selected = tree => find(tree, node => node.type === 'button' && node.props['aria-pressed'] === true);
const selectedId = tree => JSON.parse(selected(tree).key)[1];

test('initial selection prefers a populated identified wafer over unknown and heartbeat-only groups', () => {
  const component = mount();
  const tree = component.update(snapshot([event('unknown', null), event('known-empty', 'A'), summary('populated', 'Z')]));
  assert.equal(selectedId(tree), 'Z');
  assert.equal(find(tree, node => node.type === 'h1').props.children, 'Wafer Analysis');
  assert.equal(tile(tree, null).props['aria-pressed'], false);
});

test('unknown streaming default promotes to real data, then remains stable when another wafer arrives', () => {
  const component = mount(), unknown = event('unknown', null), known = summary('populated', 'Z');
  assert.equal(selectedId(component.update(snapshot([], {lot_id: 'L'}))), null);
  assert.equal(selectedId(component.update(snapshot([unknown]))), null);
  assert.equal(selectedId(component.update(snapshot([unknown, known]))), 'Z');
  assert.equal(selectedId(component.update(snapshot([unknown, known, summary('earlier-sort', 'A')]))), 'Z');
});

test('explicitly clicking the unknown default preserves it and its collapsed detail during streaming', () => {
  const component = mount(), unknown = event('unknown', null);
  let tree = component.update(snapshot([unknown]));
  tile(tree, null).props.onClick();
  tree = component.update(snapshot([unknown, summary('populated', 'Z')]));
  assert.equal(selectedId(tree), null);
  assert.equal(find(tree, node => node.props?.id === 'analysis-wafer-detail').props.hidden, true);
  tile(tree, 'Z').props.onClick();
  tree = component.update(snapshot([unknown, summary('populated', 'Z'), summary('other', 'A')]));
  assert.equal(selectedId(tree), 'Z');
  assert.equal(find(tree, node => node.props?.id === 'analysis-wafer-detail').props.hidden, false);
});

test('Next wafer is explicit, while a new run or removed group gets a fresh populated default', () => {
  const component = mount();
  const records = [event('unknown', null), summary('populated', 'Z')];
  let tree = component.update(snapshot(records));
  find(tree, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Next wafer').props.onClick();
  tree = component.update(snapshot([...records, summary('other', 'A')]));
  assert.equal(selectedId(tree), null);
  tree = component.update(snapshot(records.map(record => ({...record, run_id: 'new'})), {run_id: 'new'}));
  assert.equal(selectedId(tree), 'Z');
  tree = component.update(snapshot([{...summary('replacement', 'B'), run_id: 'new'}], {run_id: 'new'}));
  assert.equal(selectedId(tree), 'B');
});
