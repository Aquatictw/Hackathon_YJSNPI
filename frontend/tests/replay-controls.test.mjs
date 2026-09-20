import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as replay from '../lib/rtdi/replay.ts';
import * as presentation from '../lib/rtdi/ui-presentation.ts';
import {translate} from '../lib/rtdi/locale.ts';
import * as analysis from '../lib/rtdi/run-analysis.ts';
import * as source from '../lib/rtdi/source-session.ts';
import {createDashboardLifecycle} from '../lib/rtdi/ui-lifecycle.ts';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToString} from 'react-dom/server';
const raw=JSON.parse(readFileSync(new URL('../public/replay/summary.json',import.meta.url),'utf8'));
const page=readFileSync(new URL('../app/replay/page.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(page,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const symbols=new Proxy({}, {get:(_,name)=>name});

function storage(){
 const values=new Map();
 globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 return sessionStorage;
}
const imported={version:1,mode:'summary',replayView:'imported',replay:{data:raw,filename:'saved.json',selection:{waferId:'14',alertIndex:0,filter:'all',tab:'analysis',detailOpen:true}}};

// Run real component handlers with deterministic hooks and mocked transport.
// Child presentation components remain opaque; no endpoint is contacted.
function component(relative,exportName,fetch=()=>{throw Error('Unexpected request');}){
 const slots=[];let cursor=0;
 const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];};
 const hooks={...React,useState,useRef:initial=>useState(()=>({current:initial}))[0],useCallback:fn=>fn,useEffect:()=>{}};
 const context={exports:{},AbortController,fetch,require(name){
  if(name==='react')return hooks;
  if(name==='react/jsx-runtime')return jsxRuntime;
  if(name==='@/components/locale-provider')return {useLocale:()=>({t:(text,...values)=>translate('en',text,...values)})};
  if(name==='@/lib/rtdi/source-session')return source;
  if(name==='@/lib/rtdi/replay')return replay;
  if(name==='@/lib/rtdi/ui-presentation')return presentation;
  if(name.endsWith('.css'))return {};
  if(name==='lucide-react'||name.startsWith('@/components/'))return symbols;
  throw Error('Unexpected dependency: '+name);
 }};
 const code=ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code+';exports.subject='+exportName+';',context);
 return props=>{cursor=0;return context.exports.subject(props);};
}
function find(node,predicate){
 if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return;}
 if(!node||typeof node!=='object')return;
 if(predicate(node))return node;
 return find(node.props?.children,predicate);
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Use bundled example preserves Workspace import and synchronizes picker only after success',async()=>{
 storage();source.writeSourceSession(imported);const saved=source.readSourceSession().replay;
 let ok=false;
 const pageRender=component('../app/replay/page.tsx','ReplayClient');
 const props=()=>find(pageRender(),node=>node.type==='OfflineReplayAnalysis').props;
 const render=component('../components/offline-replay-analysis.tsx','OfflineReplayAnalysis',async()=>ok?Response.json(raw):new Response('',{status:503}));
 const button=()=>find(render(props()),node=>node.props?.children==='Use bundled example');
 button().props.onClick();await tick();
 assert.equal(source.readReplayView(),'imported');assert.deepEqual(source.readSourceSession().replay,saved);
 assert.equal(props().sourceChooser(()=>{}).props.summarySelected,false);
 ok=true;button().props.onClick();await tick();
 assert.equal(source.readReplayView(),'bundled');assert.equal(source.readSourceSession().mode,'summary');
 assert.deepEqual(source.readSourceSession().replay,saved);
 assert.equal(props().sourceChooser(()=>{}).props.summarySelected,true);
 assert.ok(find(render(props()),node=>Array.isArray(node.props?.children)&&node.props.children.includes('Bundled snapshot · /replay/summary.json')));
});

test('successful import updates parent and picker; invalid import leaves both unchanged',async()=>{
 storage();
 const pageRender=component('../app/replay/page.tsx','ReplayClient');
 const props=()=>find(pageRender(),node=>node.type==='OfflineReplayAnalysis').props;
 const render=component('../components/offline-replay-analysis.tsx','OfflineReplayAnalysis');
 const upload=async text=>{find(render(props()),node=>node.props?.type==='file').props.onChange({target:{files:[{name:'my.json',size:10,text:async()=>text}],value:'file'}});await tick();};
 await upload('{}');assert.equal(props().sourceChooser(()=>{}).props.summarySelected,true);
 assert.equal(source.readSourceSession(),null);
 await upload(JSON.stringify(raw));
 assert.equal(source.readReplayView(),'imported');assert.equal(source.readSourceSession().replay.filename,'my.json');
 assert.equal(props().sourceChooser(()=>{}).props.summarySelected,false);
 const remounted=component('../app/replay/page.tsx','ReplayClient');
 assert.equal(find(remounted(),node=>node.type==='OfflineReplayAnalysis').props.restoreImport,true);
});

test('archive picker Load validates before replacing the imported source',async()=>{
 storage();source.writeSourceSession(imported);
 const pageRender=component('../app/replay/page.tsx','ReplayClient');
 const props=()=>find(pageRender(),node=>node.type==='OfflineReplayAnalysis').props;
 let finish;
 const render=component('../components/offline-replay-analysis.tsx','OfflineReplayAnalysis',()=>new Promise(resolve=>{finish=resolve;}));
 find(render(props()),node=>node.type==='StoredRunPicker').props.onLoadSummary();
 assert.equal(source.readReplayView(),'imported');assert.equal(props().sourceChooser(()=>{}).props.summarySelected,false);
 finish(Response.json(raw));await tick();
 assert.equal(source.readReplayView(),'bundled');assert.equal(props().sourceChooser(()=>{}).props.summarySelected,true);
 assert.equal(source.readSourceSession().replay.filename,'saved.json');
});

test('native remount retains Replay backend view and restores the resolved tester scope',async()=>{
 const cache=storage();source.writeSourceSession(imported);
 let render=component('../app/replay/page.tsx','ReplayClient');
 const archive=find(render(),node=>node.type==='OfflineReplayAnalysis');
 archive.props.sourceChooser(()=>{}).props.onLoad('r','');
 let backend=find(render(),node=>node.type==='RunAnalysis');
 assert.equal(backend.props.initialScope.run,'r');
 const urls=[];
 const lifecycle=()=>createDashboardLifecycle({fetch:async url=>{urls.push(url);return Response.json({run:{run_id:'r',tester_id:'resolved-tester',edge_id:'recorded',mode:'replay',lot_id:null,wafer_id:null,last_event_at:'2026-09-20T09:00:00Z',data_quality:'partial'},events:[],evidence:[],incidents:[],commands:[]});},eventSource:()=>({addEventListener(){},close(){},onerror:null})},()=>{},{conversationStorage:cache});
 const first=lifecycle();await first.connect(backend.props.initialScope.run,backend.props.initialScope.tester);first.dispose();
 render=component('../app/replay/page.tsx','ReplayClient');
 backend=find(render(),node=>node.type==='RunAnalysis');assert.ok(backend);
 assert.equal(backend.props.initialScope,undefined);
 const restored=lifecycle();await restored.restoreSession();
 assert.equal(urls.at(-1),'/api/v1/runs/r?tester_id=resolved-tester');restored.dispose();
 backend.props.onSummary();
 render=component('../app/replay/page.tsx','ReplayClient');
 assert.equal(find(render(),node=>node.type==='OfflineReplayAnalysis').props.restoreImport,false);
 assert.equal(source.readSourceSession().replay.filename,'saved.json');
 assert.equal(source.readSourceSession().mode,'summary');
});

test('denied source persistence keeps the current Replay component and reports an error',()=>{
 storage();const render=component('../app/replay/page.tsx','ReplayClient');
 const archive=find(render(),node=>node.type==='OfflineReplayAnalysis');
 sessionStorage.setItem=()=>{throw Error('quota');};
 archive.props.sourceChooser(()=>{}).props.onLoad('r','t');
 assert.ok(find(render(),node=>node.type==='OfflineReplayAnalysis'));
 assert.equal(find(render(),node=>node.type==='RunAnalysis'),undefined);
 assert.match(find(render(),node=>node.props?.role==='alert').props.children,/previous dataset is retained/);
});

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
  if(name==='@/lib/rtdi/source-session')return source;
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
