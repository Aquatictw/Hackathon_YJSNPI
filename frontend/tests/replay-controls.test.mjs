import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as replay from '../lib/rtdi/replay.ts';
import * as presentation from '../lib/rtdi/ui-presentation.ts';
import {translate} from '../lib/rtdi/locale.ts';
import * as analysis from '../lib/rtdi/run-analysis.ts';
import * as sourceSession from '../lib/rtdi/source-session.ts';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToString} from 'react-dom/server';

const raw=JSON.parse(readFileSync(new URL('../public/replay/summary.json',import.meta.url),'utf8'));
const page=readFileSync(new URL('../app/replay/page.tsx',import.meta.url),'utf8');
// Expose the unchanged offline child only inside this test VM. Wrapper tests
// below exercise the actual default export and source-selection helpers.
const compiled=ts.transpileModule(page,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\nexports.offlineControls = OfflineReplayAnalysis;';
const symbols=new Proxy({}, {get:(_,name)=>name});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const response=(value=raw)=>({ok:true,status:200,json:async()=>value});
const file=(value=raw,name='import.json')=>({name,size:100,text:async()=>JSON.stringify(value)});

// Execute the page's real handlers with deterministic hook storage and mocked I/O.
// This covers state transitions, not DOM, hydration, layout or framework routing.
function harness({fetch=async()=>response(),writeText=async()=>{},wrapper=false,savedSource=null}={}){
 const values=new Map();let denyWrites=false;
 globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(denyWrites)throw Error('quota');values.set(key,value);}};
 if(savedSource)sourceSession.writeSourceSession(savedSource);
 const makeFrame=()=>({slots:[],cleanups:[],active:true});
 const root=makeFrame(),effects=[],children=[];let frame=root,cursor=0,tree,hydrated=false;
 const hooks={
  useState(initial){const i=cursor++,{slots}=frame;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;return frame.slots[i]??=({current:initial});},
  useCallback(fn,deps){const i=cursor++,old=frame.slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))frame.slots[i]={fn,deps};return frame.slots[i].fn;},
  useSyncExternalStore(_subscribe,getSnapshot,getServerSnapshot){cursor++;return hydrated?getSnapshot():getServerSnapshot();},
  useEffect(fn,deps){const i=cursor++,owner=frame,old=owner.slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old[j]))){owner.slots[i]=deps;effects.push(()=>{if(owner.active){owner.cleanups[i]?.();owner.cleanups[i]=fn();}});}},
 };
 const jsx=(type,props)=>({type,props:props??{}});
 const context={exports:{},Error,AbortController,fetch,navigator:{clipboard:{writeText}},require(name){
  if(name==='react')return hooks;
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};
  if(name==='@/lib/rtdi/replay')return replay;
  if(name==='@/lib/rtdi/ui-presentation')return presentation;
  if(name==='@/lib/rtdi/source-session')return sourceSession;
  if(name==='@/lib/rtdi/run-analysis')return analysis;
  if(name==='@/components/locale-provider')return {useLocale:()=>({locale:'en',t:(text,...values)=>translate('en',text,...values),setLocale:()=>{}})};
  if(name.endsWith('.css'))return {};
  if(name==='lucide-react'||name.startsWith('@/components/'))return symbols;
  throw Error(`Unexpected page dependency: ${name}`);
 }};
 vm.runInNewContext(compiled,context,{filename:'replay-page.js'});
 const dispose=owner=>{owner.active=false;owner.cleanups.forEach(fn=>fn?.());};
 const render=()=>{
  frame=root;cursor=0;
  if(!wrapper){tree=context.exports.offlineControls({sourceChooser:null});return tree;}
  tree=context.exports.default();
  let depth=0;
  while(typeof tree.type==='function'){
   children[depth]??=makeFrame();frame=children[depth++];cursor=0;tree=tree.type(tree.props);
  }
  children.splice(depth).forEach(dispose);
  // Backend component behavior is covered by run-analysis/ui-lifecycle tests;
  // retain its real wrapper-provided chooser here without starting transport.
  if(tree.type==='RunAnalysis')tree={...tree,props:{...tree.props,children:tree.props.sourceChooser}};
  return tree;
 };
 render();
 function nodes(value){
  if(Array.isArray(value))return value.flatMap(v=>nodes(v));
  if(!value||typeof value!=='object')return [];
  return [value,...nodes(value.props?.children)];
 }
 const textOf=value=>Array.isArray(value)?value.map(textOf).join(' '):value&&typeof value==='object'?textOf(value.props?.children):value==null||typeof value==='boolean'?'':String(value);
 const find=predicate=>{render();const node=nodes(tree).find(predicate);assert.ok(node,'Control not found');return node;};
 const button=label=>find(n=>n.type==='Button'&&textOf(n).trim()===label);
 const filter=value=>find(n=>n.props['aria-label']==='Filter wafers').props.onChange({target:{value}});
 const select=id=>find(n=>n.type==='button'&&n.props['aria-label']?.startsWith(`W${id},`)).props.onClick();
 const importFile=async value=>{const target={files:[value],value:'selected.json'};find(n=>n.type==='Input').props.onChange({target});assert.equal(target.value,'');await settle();render();};
 const flush=async()=>{render();for(let i=0;i<10;i++){effects.splice(0).forEach(fn=>fn());await settle();render();if(!effects.length)return;}throw Error('Effects did not settle');};
 return {render,button,find,filter,select,importFile,flush,text:()=>textOf(render()),nodes:()=>{render();return nodes(tree);},
  source:()=>find(n=>n.type==='RunAnalysisSourceChooser').props.source,
  async chooseSource(value){find(n=>n.type==='RunAnalysisSourceChooser').props.onChange(value);await flush();},
  denyStorage(){denyWrites=true;},
  async mount(){hydrated=true;await flush();},
  unmount(){dispose(root);children.forEach(dispose);},
 };
}

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

test('replay wrapper defaults to backend and fetches the bundled archive only after explicit selection',async()=>{
 const requests=[];const app=harness({wrapper:true,fetch:async url=>{requests.push(url);return response();}});
 assert.match(app.text(),/Restoring selected source/);assert.deepEqual(requests,[]);
 await app.mount();assert.equal(app.render().type,'RunAnalysis');assert.equal(app.source(),'backend');assert.deepEqual(requests,[]);
 await app.chooseSource('archive');assert.equal(app.source(),'archive');assert.deepEqual(requests,['/replay/summary.json']);
 assert.equal(app.nodes().filter(n=>n.type==='button'&&n.props['aria-label']?.startsWith('W')).length,25);
 await app.chooseSource('backend');assert.equal(app.render().type,'RunAnalysis');assert.equal(sourceSession.readSourceSession().mode,'backend');
 assert.equal(requests.length,1);app.unmount();
});

test('source switching aborts the offline request and ignores its late completion',async()=>{
 const pending=deferred();let signal;
 const app=harness({wrapper:true,fetch:async(_url,options)=>{signal=options.signal;return pending.promise;}});
 await app.mount();await app.chooseSource('archive');assert.equal(signal.aborted,false);
 await app.chooseSource('backend');assert.equal(signal.aborted,true);
 pending.resolve(response());await settle();assert.equal(app.render().type,'RunAnalysis');assert.doesNotMatch(app.text(),/Recorded alerts/);app.unmount();
});

test('wrapper restores an imported archive and preserves its selection through backend and back',async()=>{
 let fetches=0;
 const savedSource={version:1,mode:'summary',replay:{data:raw,filename:'saved.json',selection:{waferId:'25',alertIndex:0,filter:'all',tab:'analysis',detailOpen:true}}};
 const app=harness({wrapper:true,savedSource,fetch:async()=>{fetches++;return response();}});
 assert.match(app.text(),/Restoring selected source/);assert.doesNotMatch(app.text(),/saved.json/);assert.equal(fetches,0);
 await app.mount();assert.equal(app.source(),'archive');assert.match(app.text(),/Local import · saved.json/);assert.match(app.text(),/expected category not detected/);
 app.select('3');await app.flush();const saved=sourceSession.readSourceSession().replay;
 assert.equal(saved.selection.waferId,'3');
 await app.chooseSource('backend');assert.equal(app.render().type,'RunAnalysis');assert.deepEqual(sourceSession.readSourceSession().replay,saved);
 await app.chooseSource('archive');assert.match(app.text(),/Local import · saved.json/);
 assert.equal(app.find(n=>n.type==='button'&&n.props['aria-pressed']===true).props['aria-label'].startsWith('W3,'),true);
 assert.deepEqual(sourceSession.readSourceSession().replay,saved);assert.equal(fetches,0);app.unmount();
});

test('wrapper keeps its source and reports persistence failure when a switch cannot be saved',async()=>{
 const app=harness({wrapper:true});await app.mount();app.denyStorage();await app.chooseSource('archive');
 assert.equal(app.source(),'backend');assert.equal(app.render().type,'RunAnalysis');assert.match(app.text(),/source choice could not be saved/);app.unmount();
});

test('offline controls persist filter, alert, tab, disclosure and next-wafer selection directly',async()=>{
 const app=harness();await app.mount();await app.importFile(file(raw,'controls.json'));
 const id=String(raw.wafers.find(w=>w.alerts.length>1).wafer);
 app.select(id);app.filter('alert');
 app.find(n=>n.type==='Button'&&n.props['aria-pressed']===false).props.onClick();
 assert.equal(sourceSession.readSourceSession().replay.selection.alertIndex,1);
 app.find(n=>n.type==='Tabs').props.onValueChange('validation');
 app.select(id);
 assert.deepEqual(sourceSession.readSourceSession().replay.selection,{waferId:id,alertIndex:1,filter:'alert',tab:'validation',detailOpen:false});
 app.button('Next wafer').props.onClick();
 const selection=sourceSession.readSourceSession().replay.selection;
 assert.notEqual(selection.waferId,id);assert.equal(selection.alertIndex,0);assert.equal(selection.tab,'analysis');assert.equal(selection.detailOpen,true);
 app.unmount();
});

test('selection storage failure stays visible without replacing the saved import',async()=>{
 const app=harness();await app.mount();await app.importFile(file(raw,'retained.json'));
 const saved=sourceSession.readSourceSession();app.denyStorage();app.select('25');
 assert.match(app.text(),/latest selection could not be saved/);assert.match(app.text(),/expected category not detected/);
 assert.deepEqual(sourceSession.readSourceSession(),saved);app.unmount();
});

test('English review keeps the accepted replay counts, W25 miss and source limitations',async()=>{
 const app=harness();await app.mount();
 assert.match(app.text(),/Replay analysis/);
 assert.equal(app.nodes().filter(n=>n.type==='button'&&n.props['aria-label']?.startsWith('W')).length,25);
 assert.equal(replay.replayTotals(replay.parseReplay(raw)).alerts,14);
 app.select('25');
 assert.match(app.text(),/expected category not detected/);
 assert.match(app.text(),/No alerts recorded for this wafer/);
 for(const note of raw.limitations)assert.ok(app.text().includes(note));
 assert.match(app.text(),/Dataset limitations/);
 assert.ok(app.text().includes(raw.live_integration));
 assert.doesNotMatch(app.text(),/Live acceptance is unverified|Investigation scope|SOURCE NOTES/);
 const links=app.nodes().filter(n=>n.type==='a');
 assert.ok(links.some(n=>n.props.href==='/workspace'));
 assert.ok(links.every(n=>n.props.href==='/workspace'&&!n.props.onClick));
 assert.ok(!/[㐀-鿿]/u.test(page),'Page-owned labels should be English; source strings are retained separately');
});

test('next wafer follows imported IDs and the active filter; empty filter recovers',async()=>{
 const app=harness();await app.mount();
 const wafers=[{...raw.wafers[0],wafer:'A-17'},{...raw.wafers[1],wafer:'B-42'},{...raw.wafers[24],wafer:'Q-99'}];
 await app.importFile(file({...raw,wafers}));
 app.filter('alert');app.button('Next wafer').props.onClick();
 assert.equal(app.find(n=>n.type==='button'&&n.props['aria-pressed']===true).props['aria-label'].startsWith('WB-42,'),true);
 app.button('Next wafer').props.onClick();
 assert.match(app.find(n=>n.type==='button'&&n.props['aria-pressed']===true).props['aria-label'],/^WA-17,/);
 await app.importFile(file({...raw,wafers:[wafers[0]]}));
 app.filter('quiet');assert.match(app.text(),/No wafer selected/);assert.equal(app.button('Next wafer').props.disabled,true);
 app.filter('all');assert.match(app.text(),/Detected after/);
});

test('invalid, oversized, duplicate, live and out-of-range imports retain loaded evidence',async()=>{
 const app=harness();await app.mount();app.select('25');
 let reads=0;
 const invalid=[
  {name:'bad.json',size:10,text:async()=>'{broken'},
  {name:'large.json',size:5*1024*1024+1,text:async()=>{reads++;return '{}';}},
  file({...raw,wafers:[raw.wafers[0],raw.wafers[0]]}),
  file({...raw,mode:'live'}),
  file({...raw,wafers:[{...raw.wafers[0],devices:0}]}),
 ];
 for(const value of invalid){await app.importFile(value);assert.match(app.text(),/Any previous dataset is retained/);assert.match(app.text(),/expected category not detected/);assert.match(app.text(),/Bundled snapshot/);}
 assert.equal(reads,0);
 await app.importFile(file(raw,'recovered.json'));assert.match(app.text(),/Local import · recovered.json/);assert.doesNotMatch(app.text(),/Any previous dataset is retained/);
});

test('HTTP error is actionable and reload recovers with existing data intact',async()=>{
 let calls=0;const app=harness({fetch:async()=>++calls===2?{ok:false,status:503}:response()});await app.mount();
 app.button('Use bundled example').props.onClick();await settle();
 assert.match(app.text(),/HTTP 503/);assert.match(app.text(),/Recorded alerts/);
 app.button('Use bundled example').props.onClick();await settle();assert.doesNotMatch(app.text(),/HTTP 503/);
});

test('initial load failure leaves reload and local import available',async()=>{
 const app=harness({fetch:async()=>{throw Error('offline');}});await app.mount();
 assert.match(app.text(),/No summary loaded/);assert.notEqual(app.button('Import summary').props.disabled,true);
 assert.equal(app.button('Use bundled example').props.disabled,false);
 await app.importFile(file());assert.match(app.text(),/Local import/);
});

test('new import aborts fetch; its late response cannot overwrite the import',async()=>{
 const pending=deferred();let signal;
 const app=harness({fetch:async(_url,options)=>{signal=options.signal;return pending.promise;}});await app.mount();
 // Local import remains available to replace a stalled snapshot request.
 assert.notEqual(app.button('Import summary').props.disabled,true);
 await app.importFile(file({...raw,wafers:[raw.wafers[24]]},'preferred.json'));assert.equal(signal.aborted,true);
 pending.resolve(response());await settle();
 assert.match(app.text(),/preferred.json/);assert.match(app.text(),/expected category not detected/);
 assert.equal(app.nodes().filter(n=>n.type==='button'&&n.props['aria-label']?.startsWith('W')).length,1);
});

test('a later import wins over an older file read',async()=>{
 const pending=deferred();const app=harness();await app.mount();
 await app.importFile({name:'old.json',size:100,text:()=>pending.promise});
 await app.importFile(file(raw,'latest.json'));pending.resolve(JSON.stringify(raw));await settle();
 assert.match(app.text(),/latest.json/);assert.doesNotMatch(app.text(),/Local import · old.json/);
});

test('copy includes source identity and ignores stale completion after wafer selection',async()=>{
 const pending=deferred();let copiedText;
 const app=harness({writeText:text=>{copiedText=text;return pending.promise;}});await app.mount();
 const copy=app.button('Copy handoff').props.onClick();
 assert.equal(app.button('Copying…').props.disabled,true);
 assert.match(copiedText,/Source: Bundled snapshot/);assert.ok(copiedText.includes('wafer_id=1, alerts[0]'));assert.match(copiedText,/not a probability/);assert.match(copiedText,/tester receipt are unverified/);
 app.select('3');pending.resolve();await copy;
 assert.equal(app.button('Copy handoff').props.disabled,false);assert.doesNotMatch(app.text(),/Handoff copied/);
});

test('stale copy failure does not attach an error to another alert',async()=>{
 const pending=deferred();const app=harness({writeText:()=>pending.promise});await app.mount();
 app.select(String(raw.wafers.find(w=>w.alerts.length>1).wafer));
 const copy=app.button('Copy handoff').props.onClick();
 app.find(n=>n.type==='Button'&&n.props['aria-pressed']===false).props.onClick();
 pending.reject(Error('denied'));await copy;assert.doesNotMatch(app.text(),/Clipboard unavailable/);
});

test('clipboard retry clears its error without hiding an import error',async()=>{
 let writes=0;const app=harness({writeText:async()=>{if(++writes===1)throw Error('denied');}});await app.mount();
 await app.importFile(file({mode:'live'}));
 await app.button('Copy handoff').props.onClick();assert.match(app.text(),/Clipboard unavailable/);
 await app.button('Copy handoff').props.onClick();
 assert.match(app.text(),/Handoff copied/);assert.doesNotMatch(app.text(),/Clipboard unavailable/);assert.match(app.text(),/Invalid summary/);
});

test('unmount aborts the request and ignores late network state updates',async()=>{
 const pending=deferred();let signal;const app=harness({fetch:async(_url,options)=>{signal=options.signal;return pending.promise;}});
 await app.mount();app.unmount();assert.equal(signal.aborted,true);
 pending.resolve(response());await settle();assert.doesNotMatch(app.text(),/Recorded alerts/);
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
