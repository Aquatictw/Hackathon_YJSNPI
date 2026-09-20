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
function harness({assistant=async()=>({ok:true,json:async()=>answer}),writeText=async()=>{},locale='en'}={}){
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
  require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};if(name==='@/components/locale-provider')return {useLocale:()=>({locale,t:(text,...values)=>translate(locale,text,...values),setLocale:()=>{}})};if(name==='zod')return {z};if(name==='@/lib/rtdi/contracts')return contracts;if(name==='@/lib/rtdi/edge-adapter')return adapter;if(name==='@/lib/rtdi/fixtures')return fixtures;if(name==='lucide-react'||name.startsWith('@/components/'))return symbols;throw Error('Unexpected dependency '+name);},
 };
 vm.runInNewContext(compiled,context,{filename:'sandbox-page.js'});
 function render(){assert.equal(unmounted,false);let turns=0;do{assert.ok(++turns<20,'Hook render did not settle');dirty=false;cursor=0;tree=context.exports.default();queued.splice(0).forEach(run=>run());}while(dirty);return tree;}
 const nodes=value=>Array.isArray(value)?value.flatMap(nodes):!value||typeof value!=='object'?[]:[value,...nodes(value.props?.children)];
 const textOf=value=>Array.isArray(value)?value.map(textOf).join(' '):value&&typeof value==='object'?textOf(value.props?.children):value==null||typeof value==='boolean'?'':String(value);
 const find=predicate=>{const result=nodes(render()).find(predicate);assert.ok(result,'Control not found');return result;};
 const button=label=>find(n=>n.type==='Button'&&textOf(n).trim()===label);
 const draft=value=>find(n=>n.props['aria-label']===translate(locale,'Investigation question')).props.onChange({target:{value}});
 render();
 return {requests,render,find,button,draft,text:()=>textOf(render()),setLocale(value){locale=value;render();},
  receive(){button('Receive fixture').props.onClick();render();},
  reset(){button('Reset workspace').props.onClick();render();},
  selectFirst(){find(n=>n.type==='button'&&n.props.className?.startsWith('inbox-item')).props.onClick();render();},
  selectSecond(){const inbox=nodes(render()).filter(n=>n.type==='button'&&n.props.className?.startsWith('inbox-item'));assert.ok(inbox[1]);inbox[1].props.onClick();render();},
  submit(){find(n=>n.type==='form'&&n.props.className==='composer').props.onSubmit({preventDefault(){}});},
  question:()=>find(n=>n.props['aria-label']===translate(locale,'Investigation question')).props.value,
  busy:()=>find(n=>n.props['aria-label']===translate(locale,'Investigation question')).props.disabled,
  async mount(){await settle();render();},
  unmount(){unmounted=true;slots.forEach(slot=>slot?.cleanup?.());},
  lateWrites:()=>lateWrites,
 };
}

function loadPractice(app,kind){
 app.find(node=>node.props.id==='practice-scenario').props.onChange({target:{value:kind}});
 app.button('Load practice example').props.onClick();app.render();
}
const selectedView=app=>JSON.parse(app.find(node=>node.type==='pre').props.children);
const mean=values=>values.reduce((total,value)=>total+value,0)/values.length;
const eventMessage=app=>app.find(node=>node.props.className==='event-message').props.children;

for(const kind of ['anomaly','normal','missing'])test(`built-in ${kind} fixture uses English source copy and follows global language`,async()=>{
 const app=harness();await app.mount();
 app.find(n=>n.props['aria-label']==='Fixture scenario').props.onChange({target:{value:kind}});app.receive();
 const original=selectedView(app);contracts.validatedView(original);
 assert.doesNotMatch(app.text(),/[\u3400-\u9fff]/);
 assert.ok(original.predictions.every(p=>p.unit==='°C (demonstration)'));
 app.setLocale('zh-TW');assert.match(eventMessage(app),/[\u3400-\u9fff]/);
 assert.deepEqual(selectedView(app),original,'language changes must not rewrite received source');
 app.setLocale('en');assert.equal(eventMessage(app),original.event.message);
 app.find(n=>n.props['aria-label']==='Fixture scenario').props.onChange({target:{value:'duplicate'}});app.receive();
 assert.match(app.text(),/Ignored 1 duplicate events/);assert.deepEqual(selectedView(app),original);
});

test('Chinese fixture switches presentation to English without rewriting copied source',async()=>{
 let copied;const app=harness({locale:'zh-TW',writeText:async text=>{copied=text;}});await app.mount();
 app.button(translate('zh-TW','Receive fixture')).props.onClick();const original=selectedView(app);
 assert.match(original.event.message,/[\u3400-\u9fff]/);
 app.setLocale('en');assert.doesNotMatch(eventMessage(app),/[\u3400-\u9fff]/);
 assert.ok(app.find(n=>n.type==='h2'&&n.props.children==='Site 2 test mean continues to rise'));
 assert.ok(app.find(n=>n.type==='small'&&n.props.children==='°C (demonstration)'));
 await app.button('Copy source').props.onClick();assert.deepEqual(JSON.parse(copied),original);
});

test('JSON fixture editor uses current language while imported source text remains verbatim',async()=>{
 const app=harness();await app.mount();app.button('Load fixture').props.onClick();
 const draft=app.find(n=>n.props.id==='batch-json').props.value;assert.doesNotMatch(draft,/[\u3400-\u9fff]/);
 app.button('Receive JSON').props.onClick();contracts.validatedView(selectedView(app));
 const source=fixtures.createFixture('anomaly',900);
 app.find(n=>n.props.id==='batch-json').props.onChange({target:{value:JSON.stringify(source)}});app.button('Receive JSON').props.onClick();
 const original=selectedView(app);assert.equal(eventMessage(app),original.event.message);assert.match(eventMessage(app),/[\u3400-\u9fff]/);
 app.setLocale('zh-TW');app.setLocale('en');assert.deepEqual(selectedView(app),original);assert.equal(eventMessage(app),original.event.message);
});

test('loaded practice narrative follows language switches without changing source',async()=>{
 const app=harness();await app.mount();loadPractice(app,'drift');const original=selectedView(app);
 app.setLocale('zh-TW');assert.match(eventMessage(app),/合成練習/);
 app.setLocale('en');assert.equal(eventMessage(app),original.event.message);assert.deepEqual(selectedView(app),original);
});

for(const kind of ['healthy','site','drift','missing'])test(`practice ${kind} loads a validated synthetic context and answers locally`,async()=>{
 const app=harness();await app.mount();loadPractice(app,kind);
 const view=selectedView(app);contracts.validatedView(view);
 assert.equal(view.event.mode,'simulation');assert.equal(view.event.run_id,'SANDBOX-PRACTICE');
 assert.match(view.event.message,/Synthetic practice/);assert.match(view.event.wafer_id,/^SYNTHETIC-/);
 assert.equal(view.predictions.length,6);assert.ok(view.predictions.every(p=>p.tester_receipt_id===null));
 assert.equal(app.requests.length,0);
 const guide=app.find(node=>node.props['aria-label']==='Selected practice guidance');
 const draftButton=guide.props.children[2].props.children[1][0];
 assert.equal(draftButton.props.type,'button');draftButton.props.onClick();
 assert.ok(app.question().length>30);assert.equal(app.requests.length,0);app.submit();
 assert.equal(app.requests.length,0);assert.equal(app.question(),'');
 assert.match(app.text(),/Fixed practice explanation/);assert.match(app.text(),/Tester receipt is unconfirmed/);
 assert.ok(app.text().includes(view.evidence[0].evidence_id));
});

test('healthy, fixed site offset and temporal drift have distinct honest sequences',async()=>{
 const app=harness();await app.mount();
 loadPractice(app,'healthy');let view=selectedView(app);
 assert.equal(view.event.incident_id,null);assert.ok(view.predictions.every(p=>p.actual!==null&&p.coverage===1));
 assert.equal(Object.keys(view.evidence[0].site_series).length,4);
 for(const values of Object.values(view.evidence[0].site_series))assert.ok(Math.abs(mean(values)-1)<.002);
 loadPractice(app,'site');view=selectedView(app);let sites=view.evidence[0].site_series;
 assert.equal(view.event.kind,'external_evidence');assert.match(view.incident.title,/Site imbalance/);
 assert.ok(mean(sites['2'])-mean(sites['1'])>.17);assert.ok(Math.max(...sites['2'])-Math.min(...sites['2'])<.02);
 assert.equal(view.evidence[0].observed,Number(mean(sites['2']).toFixed(4)));
 loadPractice(app,'drift');view=selectedView(app);sites=view.evidence[0].site_series;
 assert.equal(view.event.kind,'mean_drift');assert.ok(sites['2'].at(-1)-sites['2'][0]>.24);
 assert.ok(view.evidence[0].observed>view.evidence[0].threshold);assert.ok(Math.max(...sites['1'])-Math.min(...sites['1'])<.02);
});

test('late actual enriches only stage 6; missing stage 3 stays null and no receipt is fabricated',async()=>{
 const app=harness();await app.mount();loadPractice(app,'missing');
 const before=selectedView(app);const stage3=before.predictions.find(p=>p.stage===3);const stage6=before.predictions.find(p=>p.stage===6);
 assert.equal(stage3.predicted,null);assert.equal(stage3.actual,null);assert.equal(stage3.coverage,.75);assert.equal(stage3.response_status,'insufficient_data');
 assert.equal(stage6.predicted,26.05);assert.equal(stage6.actual,null);assert.equal(stage6.coverage,1);assert.equal(stage6.response_status,'response_queued');
 assert.equal(before.evidence[0].missing_fields.length,8);assert.match(app.text(),/Stage 6 actual: waiting/);
 app.button('Receive late stage 6 actual').props.onClick();
 const after=selectedView(app);contracts.validatedView(after);
 assert.equal(after.event.event_id,before.event.event_id);assert.equal(after.predictions.length,6);
 assert.deepEqual(after.predictions.find(p=>p.stage===6),{...stage6,actual:26.02});
 assert.deepEqual(after.predictions.find(p=>p.stage===3),stage3);
 assert.equal(app.button('Receive late stage 6 actual').props.disabled,true);assert.match(app.text(),/Synthetic stage 6 actual joined/);
 assert.equal(app.requests.length,0);
});

test('practice guidance follows selected event rather than the unloaded picker selection',async()=>{
 const app=harness();await app.mount();loadPractice(app,'site');
 app.find(n=>n.props.id==='practice-scenario').props.onChange({target:{value:'missing'}});
 assert.match(app.text(),/Loaded practice:.*Site imbalance/);
 loadPractice(app,'missing');app.selectSecond();assert.match(app.text(),/Loaded practice:.*Site imbalance/);
 app.receive();assert.doesNotMatch(app.text(),/Loaded practice:/);
 assert.equal(selectedView(app).event.event_id.startsWith('demo-event-'),true);
});

test('practice stays bilingual across language changes, including drafts and local explanations',async()=>{
 const app=harness();await app.mount();loadPractice(app,'missing');app.setLocale('zh-TW');
 assert.match(app.text(),/合成情境練習/);assert.match(app.text(),/預測資料缺漏／延遲/);
 app.button('為何第 3 階段無法預測，而第 6 階段是在等待實際值？').props.onClick();
 assert.match(app.question(),/為何第 3 階段/);app.submit();assert.match(app.text(),/固定練習說明/);assert.equal(app.requests.length,0);
 app.button('載入練習範例').props.onClick();assert.match(selectedView(app).event.message,/合成練習/);
 app.button('接收第 6 階段延遲實際值').props.onClick();assert.match(app.text(),/實際值已配對/);
});

test('reset clears practice, JSON and chat drafts while later loads get fresh identities',async()=>{
 const app=harness();await app.mount();loadPractice(app,'missing');const firstId=selectedView(app).event.event_id;
 app.find(n=>n.props.id==='batch-json').props.onChange({target:{value:'invalid pending JSON'}});app.draft('Pending question');
 app.reset();assert.equal(app.question(),'');assert.equal(app.find(n=>n.props.id==='batch-json').props.value,'');
 assert.equal(app.find(n=>n.props.id==='practice-scenario').props.value,'healthy');assert.doesNotMatch(app.text(),/Loaded practice:/);
 assert.match(app.text(),/No events loaded/);loadPractice(app,'missing');assert.notEqual(selectedView(app).event.event_id,firstId);
 assert.equal(selectedView(app).predictions.find(p=>p.stage===6).actual,null);
});

test('JSON imports and duplicate delivery retain their existing behavior alongside practice',async()=>{
 const app=harness();await app.mount();loadPractice(app,'healthy');
 app.find(n=>n.props['aria-label']==='Fixture scenario').props.onChange({target:{value:'duplicate'}});app.receive();
 assert.match(app.text(),/Ignored 1 duplicate events/);
 const batch=fixtures.createFixture('normal',500);
 app.find(n=>n.props.id==='batch-json').props.onChange({target:{value:JSON.stringify(batch)}});app.button('Receive JSON').props.onClick();
 assert.equal(selectedView(app).event.event_id,'demo-event-normal-500');assert.doesNotMatch(app.text(),/Loaded practice:/);
 assert.equal(app.requests.length,0);
});

test('loading practice cancels an older investigation and switches to local rule-based mode',async()=>{
 const body=deferred();const app=harness({assistant:async()=>({ok:true,json:()=>body.promise})});await app.mount();app.receive();
 app.find(n=>n.props['aria-label']==='Response mode').props.onChange({target:{value:'openai'}});app.draft('Previous context');app.submit();await settle();
 assert.equal(app.requests.length,1);loadPractice(app,'site');assert.equal(app.requests[0].signal.aborted,true);
 assert.equal(app.find(n=>n.props['aria-label']==='Response mode').props.value,'demo');
 body.resolve(answer);await settle();assert.doesNotMatch(app.text(),/Controlled investigation result/);
 assert.equal(app.question(),'');assert.equal(app.busy(),false);app.draft('Explain the offset');app.submit();
 assert.match(app.text(),/The site-2 series is stable/);assert.equal(app.requests.length,1);
});
