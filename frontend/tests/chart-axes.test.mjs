import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '../lib/rtdi/locale.ts';
import { replayChart, alertNames } from '../lib/rtdi/replay.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const renderers = [
  ['../app/workspace/page.tsx', 'Plot', 'function Answer', 'e'],
  ['../app/sandbox/page.tsx', 'Trend', 'export default function Home', 'evidence'],
  ['../components/offline-replay-analysis.tsx', 'EvidencePlot', 'export function OfflineReplayAnalysis', 'alert'],
  ['../components/imported-summary-workspace.tsx', 'SummaryPlot', 'export function ImportedSummaryWorkspace', 'alert'],
];
function compile(source, locale, dependencies = {}) {
  const output = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const context = {exports: {}, require(name) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === '@/components/locale-provider') return {useLocale: () => ({locale, t: (text, ...values) => translate(locale, text, ...values)})};
    if (name.endsWith('.css')) return {};
    if (name in dependencies) return dependencies[name];
    throw Error('Unexpected chart dependency: ' + name);
  }};
  vm.runInNewContext(output, context);
  return context.exports;
}
function chart(entry, locale) {
  const [path, name, end] = entry;
  const source = read(path);
  const body = source.slice(source.indexOf('function ' + name + '('), source.indexOf(end));
  const {PlotAxes} = compile(read('../components/plot-axes.tsx'), locale);
  return compile(`
    import {useLocale} from '@/components/locale-provider';
    import {useRef,useState,useEffect} from 'react';
    import {PlotAxes} from '@/components/plot-axes';
    import {replayChart,alertNames} from 'replay';
    const colors=['red','blue','green','orange'];const palette=colors;
    const Activity=()=>null;const CircleDashed=()=>null;
    ${body}
    export {${name}};
  `, locale, {'@/components/plot-axes': {PlotAxes}, replay: {replayChart, alertNames}})[name];
}
const evidence = {event_id:'chart-test', kind:'mean_drift_up', metric:'measurement', unit:'V', baseline:null, series:[1,2,3], site_series:{'1':[1,2,3], '2':[2,3,4]}};

for (const locale of ['en', 'zh-TW']) for (const entry of renderers) {
  test(`${entry[1]} has visible, accessible ${locale} axis titles for site, yield and empty series`, () => {
    const Component = chart(entry, locale);
    const render = data => renderToStaticMarkup(React.createElement(Component, {[entry[3]]: data}));
    const markup = render(evidence);
    assert.match(markup, /role="group" aria-labelledby=/);
    assert.match(markup, locale === 'en' ? /Y axis.*Measurement value [(]unit unconfirmed[)]/ : /Y 軸.*量測值（單位未確認）/);
    assert.match(markup, locale === 'en' ? /X axis.*Completed-device order within each site [(]not time[)]/ : /X 軸.*各測試站內已完成元件順序（非時間）/);
    // Both titles are HTML outside the SVG; they can wrap without scaling down.
    assert.ok(markup.indexOf('plot-axis-title--y') < markup.indexOf('<svg'));
    assert.ok(markup.indexOf('plot-axis-title--x') > markup.indexOf('</svg>'));
    const yielded = render({...evidence, kind:'low_yield', metric:'yield', series:entry[1] === 'Trend' ? [{index:1,value:.9},{index:2,value:.95}] : [.9,.95]});
    assert.match(yielded, locale === 'en' ? /Cumulative yield [(]%[)]/ : /累積良率（%）/);
    assert.doesNotMatch(yielded, /Source unit label: V|來源單位標記：V/);
    const empty = render({...evidence,series:[],site_series:{}});
    assert.doesNotMatch(empty, /<svg|plot-axis-title/);
  });
}

test('single-series measurement, untrusted unit labels and coverage keep truthful units', () => {
  const {PlotAxes} = compile(read('../components/plot-axes.tsx'), 'en');
  const render = props => renderToStaticMarkup(React.createElement(PlotAxes, props, React.createElement('svg')));
  const measurement = render({unit:'<b>°C</b>'});
  assert.match(measurement, /Measurement value [(]unit unconfirmed[)]/);
  assert.ok(measurement.includes('Source unit label: &lt;b&gt;°C&lt;/b&gt;'));
  assert.match(measurement, /Completed-device order [(]not time[)]/);
  assert.match(render({metric:'coverage'}), /Feature coverage [(]ratio, 0–1[)]/);
  assert.doesNotMatch(render({unit:'  '}), /Source unit label/);
});
