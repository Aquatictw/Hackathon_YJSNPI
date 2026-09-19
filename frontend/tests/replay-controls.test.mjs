import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as replay from '../lib/rtdi/replay.ts';
import * as presentation from '../lib/rtdi/ui-presentation.ts';

const raw=JSON.parse(readFileSync(new URL('../public/replay/summary.json',import.meta.url),'utf8'));
const page=readFileSync(new URL('../app/replay/page.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(page,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const symbols=new Proxy({}, {get:(_,name)=>name});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const response=(value=raw)=>({ok:true,status:200,json:async()=>value});
const file=(value=raw,name='import.json')=>({name,size:100,text:async()=>JSON.stringify(value)});

// Execute the page's real handlers with deterministic hook storage and mocked I/O.
// This covers state transitions, not DOM, hydration, layout or framework routing.
function harness({fetch=async()=>response(),writeText=async()=>{}}={}){
 const slots=[],effects=[];let cursor=0,tree,cleanups=[];
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},
  useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}},
 };
 const jsx=(type,props)=>({type,props:props??{}});
 const context={exports:{},Error,AbortController,fetch,navigator:{clipboard:{writeText}},require(name){
  if(name==='react')return hooks;
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};
  if(name==='@/lib/rtdi/replay')return replay;
  if(name==='@/lib/rtdi/ui-presentation')return presentation;
  if(name.endsWith('.css'))return {};
  if(name==='lucide-react'||name.startsWith('@/components/'))return symbols;
  throw Error(`Unexpected page dependency: ${name}`);
 }};
 vm.runInNewContext(compiled,context,{filename:'replay-page.js'});
 const render=()=>{cursor=0;tree=context.exports.default();return tree;};
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
 return {render,button,find,filter,select,importFile,text:()=>textOf(render()),nodes:()=>{render();return nodes(tree);},
  async mount(){cleanups=effects.splice(0).map(fn=>fn());await settle();render();},
  unmount(){cleanups.forEach(fn=>fn?.());},
 };
}

test('English review keeps the accepted replay counts, W25 miss and source limitations',async()=>{
 const app=harness();await app.mount();
 assert.match(app.text(),/Replay analysis/);
 assert.equal(app.nodes().filter(n=>n.type==='button'&&n.props['aria-label']?.startsWith('W')).length,25);
 assert.equal(replay.replayTotals(replay.parseReplay(raw)).alerts,14);
 app.select('25');
 assert.match(app.text(),/expected category not detected/);
 assert.match(app.text(),/No alerts recorded for this wafer/);
 for(const note of raw.limitations)assert.ok(app.text().includes(note));
 assert.match(app.text(),/final-device alert does not prove delivery/);
 assert.ok(app.nodes().filter(n=>n.type==='a').every(n=>n.props.href==='/'&&!n.props.onClick));
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
 app.button('Reload snapshot').props.onClick();await settle();
 assert.match(app.text(),/HTTP 503/);assert.match(app.text(),/Recorded alerts/);
 app.button('Reload snapshot').props.onClick();await settle();assert.doesNotMatch(app.text(),/HTTP 503/);
});

test('initial load failure leaves reload and local import available',async()=>{
 const app=harness({fetch:async()=>{throw Error('offline');}});await app.mount();
 assert.match(app.text(),/No summary loaded/);assert.notEqual(app.button('Import summary').props.disabled,true);
 assert.equal(app.button('Reload snapshot').props.disabled,false);
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
