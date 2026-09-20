import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as contracts from '../lib/rtdi/contracts.ts';
import * as adapter from '../lib/rtdi/edge-adapter.ts';
import * as fixtures from '../lib/rtdi/fixtures.ts';
import {translate} from '../lib/rtdi/locale.ts';

const page=readFileSync(new URL('../app/sandbox/page.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(page,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const answer={answer:'Controlled investigation result',mode:'demo',model:null};
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));

// Real page handlers and contract adapters; deterministic hooks and deferred I/O.
// No browser, network, model call, hydration or visual acceptance is implied.
function harness({assistant=async()=>({ok:true,json:async()=>answer}),writeText=async()=>{}}={}){
 const slots=[],queued=[],requests=[];let cursor=0,dirty=false,tree,unmounted=false,lateWrites=0;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{if(unmounted)lateWrites++;const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const prior=slots[i];slots[i]={deps,cleanup:prior?.cleanup};queued.push(()=>{prior?.cleanup?.();slots[i].cleanup=fn();});}},
 };
 const jsx=(type,props)=>({type,props:props??{}});
 const symbols=new Proxy({}, {get:(_,name)=>name});
 const listeners=new Map();
 const context={exports:{},Error,AbortController,navigator:{clipboard:{writeText}},document:{},
  window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
  fetch:async(url,options)=>{if(url==='/api/config')return {ok:true,json:async()=>({openai_configured:true,model:'test-only'})};assert.equal(url,'/api/assistant');requests.push(options);return assistant(options);},
  require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};if(name==='@/components/locale-provider')return {useLocale:()=>({locale:'en',t:(text,...values)=>translate('en',text,...values),setLocale:()=>{}})};if(name==='zod')return {z};if(name==='@/lib/rtdi/contracts')return contracts;if(name==='@/lib/rtdi/edge-adapter')return adapter;if(name==='@/lib/rtdi/fixtures')return fixtures;if(name==='lucide-react'||name.startsWith('@/components/'))return symbols;throw Error('Unexpected dependency '+name);},
 };
 vm.runInNewContext(compiled,context,{filename:'sandbox-page.js'});
 function render(){assert.equal(unmounted,false);let turns=0;do{assert.ok(++turns<20,'Hook render did not settle');dirty=false;cursor=0;tree=context.exports.default();queued.splice(0).forEach(run=>run());}while(dirty);return tree;}
 const nodes=value=>Array.isArray(value)?value.flatMap(nodes):!value||typeof value!=='object'?[]:[value,...nodes(value.props?.children)];
 const textOf=value=>Array.isArray(value)?value.map(textOf).join(' '):value&&typeof value==='object'?textOf(value.props?.children):value==null||typeof value==='boolean'?'':String(value);
 const find=predicate=>{const result=nodes(render()).find(predicate);assert.ok(result,'Control not found');return result;};
 const button=label=>find(n=>n.type==='Button'&&textOf(n).trim()===label);
 const draft=value=>find(n=>n.props['aria-label']==='Investigation question').props.onChange({target:{value}});
 render();
 return {requests,render,find,button,draft,text:()=>textOf(render()),
  receive(){button('Receive fixture').props.onClick();render();},
  reset(){button('Reset workspace').props.onClick();render();},
  selectFirst(){find(n=>n.type==='button'&&n.props.className?.startsWith('inbox-item')).props.onClick();render();},
  selectSecond(){const inbox=nodes(render()).filter(n=>n.type==='button'&&n.props.className?.startsWith('inbox-item'));assert.ok(inbox[1]);inbox[1].props.onClick();render();},
  submit(){find(n=>n.type==='form'&&n.props.className==='composer').props.onSubmit({preventDefault(){}});},
  question:()=>find(n=>n.props['aria-label']==='Investigation question').props.value,
  busy:()=>find(n=>n.props['aria-label']==='Investigation question').props.disabled,
  async mount(){await settle();render();},
  unmount(){unmounted=true;slots.forEach(slot=>slot?.cleanup?.());},
  lateWrites:()=>lateWrites,
 };
}

test('templates fill draft only; explicit submit sends once with English fixture context',async()=>{
 const app=harness();await app.mount();app.receive();
 for(const prompt of ['What does this alert indicate?','What should be checked next?','Is tester receipt confirmed (ACK)?']){
  const button=app.button(prompt);assert.equal(button.props.type,'button');button.props.onClick();assert.equal(app.question(),prompt);assert.equal(app.requests.length,0);
 }
 assert.match(app.text(),/Draft only/);assert.match(app.text(),/Investigation log/);assert.doesNotMatch(page,/Sparkles|ai-icon|ai-stat/);
 assert.match(app.text(),/The latest 32 test results at site 2 show an upward trend/);
 app.submit();assert.equal(app.requests.length,1);await settle();assert.match(app.text(),/Controlled investigation result/);assert.equal(app.busy(),false);
});

for(const transition of ['reset','receive','selectFirst'])for(const outcome of ['success','error']){
 test('late JSON '+outcome+' cannot mutate chats/draft after '+transition,async()=>{
  const body=deferred();const app=harness({assistant:async()=>({ok:true,json:()=>body.promise})});await app.mount();app.receive();app.receive();
  app.draft('Old question');app.submit();await settle();assert.equal(app.requests.length,1);
  app[transition]();assert.equal(app.requests[0].signal.aborted,true);if(transition==='reset')app.receive();app.draft('Destination draft');
  if(outcome==='success')body.resolve(answer);else body.reject(Error('Late body error'));await settle();
  assert.equal(app.question(),'Destination draft');assert.equal(app.busy(),false);assert.doesNotMatch(app.text(),/Controlled investigation result|Late body error/);
  app.selectFirst();assert.doesNotMatch(app.text(),/Controlled investigation result|Old question|Late body error/);
  if(transition!=='reset'){app.selectSecond();assert.doesNotMatch(app.text(),/Controlled investigation result|Old question|Late body error/);}
 });
}

test('old finally cannot clear a newer pending request; current request still completes',async()=>{
 const bodies=[deferred(),deferred()];let calls=0;const app=harness({assistant:async()=>({ok:true,json:()=>bodies[calls++].promise})});await app.mount();app.receive();app.draft('Old');app.submit();await settle();
 app.receive();app.draft('New');app.submit();await settle();bodies[0].resolve(answer);await settle();assert.equal(app.busy(),true);assert.doesNotMatch(app.text(),/Controlled investigation result/);
 bodies[1].resolve({...answer,answer:'New context result'});await settle();assert.equal(app.busy(),false);assert.match(app.text(),/New context result/);
});

test('current response failure restores its submitted draft for explicit retry',async()=>{
 const app=harness({assistant:async()=>({ok:false,json:async()=>({error:'Service unavailable'})})});await app.mount();app.receive();app.draft('Retry this question');app.submit();await settle();
 assert.equal(app.question(),'Retry this question');assert.match(app.text(),/Service unavailable/);assert.equal(app.busy(),false);assert.equal(app.requests.length,1);
});

for(const outcome of ['success','error'])test('unmount ignores deferred JSON '+outcome,async()=>{
 const body=deferred();const app=harness({assistant:async()=>({ok:true,json:()=>body.promise})});await app.mount();app.receive();app.draft('Pending');app.submit();await settle();app.unmount();assert.equal(app.requests[0].signal.aborted,true);
 if(outcome==='success')body.resolve(answer);else body.reject(Error('Late error'));await settle();assert.equal(app.lateWrites(),0);
});

for(const transition of ['reset','receive','selectFirst'])for(const outcome of ['success','error'])test('stale clipboard '+outcome+' is ignored after '+transition,async()=>{
 const clipboard=deferred();const app=harness({writeText:()=>clipboard.promise});await app.mount();app.receive();app.receive();
 const copying=app.button('Copy source').props.onClick();app[transition]();if(transition==='reset')app.receive();
 if(outcome==='success')clipboard.resolve();else clipboard.reject(Error('Denied'));await copying;assert.ok(app.button('Copy source'));assert.doesNotMatch(app.text(),/Clipboard unavailable/);
});
