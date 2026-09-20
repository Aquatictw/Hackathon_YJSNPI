import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as replay from '../lib/rtdi/replay.ts';
import * as presentation from '../lib/rtdi/ui-presentation.ts';
import {translate} from '../lib/rtdi/locale.ts';
import * as analysis from '../lib/rtdi/run-analysis.ts';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToString} from 'react-dom/server';
const raw=JSON.parse(readFileSync(new URL('../public/replay/summary.json',import.meta.url),'utf8'));
const page=readFileSync(new URL('../app/replay/page.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(page,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const symbols=new Proxy({}, {get:(_,name)=>name});

test('real server rendering keeps the source placeholder without reading browser storage or starting transport',()=>{
 const unavailable=()=>{throw Error('Browser source accessed during SSR');};
 const context={exports:{},require(name){
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsxRuntime;
  if(name==='@/components/locale-provider')return {useLocale:()=>({t:(text,...values)=>translate('en',text,...values)})};
  if(name==='@/components/app-header')return {AppHeader:()=>null};
  if(name==='@/lib/rtdi/run-analysis')return {...analysis,initialAnalysisSource:unavailable};
  if(name==='@/lib/rtdi/source-session')return {readSourceSession:unavailable};
  if(name==='@/lib/rtdi/replay')return replay;
  if(name==='@/lib/rtdi/ui-presentation')return presentation;
  if(name.endsWith('.css'))return {};
  if(name==='lucide-react'||name.startsWith('@/components/'))return symbols;
  throw Error(`Unexpected server page dependency: ${name}`);
 },fetch:unavailable};
 vm.runInNewContext(compiled,context);
 const html=renderToString(React.createElement(context.exports.default));
 assert.match(html,/Restoring selected source/);assert.match(html,/aria-busy="true"/);assert.doesNotMatch(html,/Offline JSON archive|Stored \/ live backend run/);
});

test('hydrated Replay defaults to the restored archive without mounting backend transport',()=>{
 const forbidden=()=>{throw Error('Legacy archive access');};
 const context={exports:{},require(name){
  if(name==='react')return {...React,useSyncExternalStore:(_subscribe,getSnapshot)=>getSnapshot()};
  if(name==='react/jsx-runtime')return jsxRuntime;
  if(name==='@/components/run-analysis')return {RunAnalysis:forbidden};
  if(name==='@/components/offline-replay-analysis')return {OfflineReplayAnalysis:()=>React.createElement('div',null,'Offline wafer archive')};
  if(name==='@/components/stored-run-picker')return {StoredRunPicker:()=>null};
  if(name==='@/components/locale-provider')return {useLocale:()=>({t:text=>text})};
  if(name==='@/components/app-header')return {AppHeader:()=>null};
  if(name.endsWith('.css'))return {};
  throw Error('Unexpected dependency: '+name);
 },sessionStorage:{getItem:forbidden},fetch:forbidden};
 vm.runInNewContext(compiled,context);
 assert.equal(renderToString(React.createElement(context.exports.default)),'<div>Offline wafer archive</div>');
});

test('display translations preserve all source alert payloads and chart arrays',()=>{
 const data=replay.parseReplay(raw);const alerts=data.wafers.flatMap(w=>w.alerts);
 assert.equal(alerts.length,14);
 for(const [i,w] of data.wafers.entries())assert.deepEqual(w.alerts,raw.wafers[i].alerts);
 for(const alert of alerts){
  const handoff=replay.investigationText('source-id',alert);
  assert.ok(handoff.includes(alert.message));assert.ok(handoff.includes(alert.suggestion));
  assert.match(handoff,/not a probability/);
  const lines=replay.replayChart(alert);
  if(alert.kind==='low_yield'){assert.equal(lines[0].name,'Cumulative yield');assert.equal(lines[0].values,alert.series);}
  else if(Object.values(alert.site_series).some(values=>values.length))assert.deepEqual(lines.map(line=>line.values),Object.values(alert.site_series).filter(values=>values.length));
  else assert.equal(lines[0].values,alert.series);
 }
});
