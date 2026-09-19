import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adaptIncoming} from '../lib/rtdi/edge-adapter.ts';
import {emptyWorkspace,receiveBatch,ackSchema} from '../lib/rtdi/contracts.ts';
import {predictionRows} from '../lib/rtdi/ui-predictions.ts';
import {commandStatuses} from '../lib/rtdi/command-contract.ts';
import {commandLabels,parseSnapshot} from '../lib/rtdi/dashboard.ts';
const timestamp='2026-09-19T00:00:00Z';
const base={source_mode:'live',run_id:'r',tester_id:'t',lot_id:'l',wafer_id:'w',timestamp};
const prediction=(site=1,overrides={})=>({...base,type:'prediction',event_id:`p${site}`,request_id:'request',device_id:`d${site}`,site_id:site,stage:1,prediction:0,...overrides});
const actual=(site=1,overrides={})=>({...base,type:'prediction_actual',event_id:`a${site}`,request_id:'request',device_id:`d${site}`,site_id:site,actual:site,...overrides});
const packet=(events,batch_id='batch')=>({schema_version:1,edge_id:'edge',batch_id,events});
const receive=(events,state=emptyWorkspace(),id='batch')=>receiveBatch(state,adaptIncoming(packet(events,id),state));

test('all backend states validate and queueing never claims tester execution',()=>{
 const commands=commandStatuses.map(status=>({command_id:status,run_id:'r',tester_id:'t',incident_id:'i',kind:'show_message',message:'hello',status,created_at:timestamp,updated_at:timestamp,expires_at:timestamp}));
 const snapshot={run:{run_id:'r',tester_id:'t',edge_id:'edge',mode:'live',lot_id:'l',wafer_id:'w',data_quality:'partial',last_event_at:timestamp},commands,events:[],evidence:[],incidents:[]};
 assert.equal(parseSnapshot(snapshot,'r','t').commands.length,7);
 assert.deepEqual(Object.keys(commandLabels),[...commandStatuses]);
 assert.match(commandLabels.queued_to_tester,/機台未確認/);
 assert.doesNotMatch(commandLabels.queued_to_tester,/已執行/);
 for(const status of commandStatuses.filter(s=>s!=='queued'))assert.equal(ackSchema.safeParse({type:'command_ack',ack_id:'a',command_id:'c',run_id:'r',tester_id:'t',status,occurred_at:timestamp,tester_receipt_id:status==='tester_confirmed'?'receipt':null,detail:''}).success,true);
 for(const status of ['edge_received','edge_executed','made_up'])assert.throws(()=>parseSnapshot({...snapshot,commands:[{...commands[0],status}]},'r','t'));
 assert.equal(parseSnapshot({...snapshot,commands:[{...commands[3],tester_receipt_id:'receipt'}]},'r','t').commands[0].tester_receipt_id,'receipt');
 const schema=JSON.parse(readFileSync(new URL('../contracts/schemas.json',import.meta.url)));
 assert.deepEqual(schema.$defs.command_ack.properties.status.enum,commandStatuses.filter(s=>s!=='queued'));
});
test('wire evidence retains all 320 samples, per-site series, zero threshold and yield semantics',()=>{
 const series=Array.from({length:320},(_,i)=>i/320);
 const state=receive([{...base,type:'evidence',event_id:'e',evidence_id:'proof',kind:'low_yield',current_value:0,baseline:0,threshold:0,series,site_series:{1:[0,.2],2:[.3,.5]},sample_count:320,affected_tests:['yield'],score:.9,suggestion:'Inspect bins',response_status:'response_queued',tester_receipt_id:null,message:'source message'}]);
 const evidence=state.items[0].evidence[0];
 assert.equal(evidence.series.length,320);assert.deepEqual(evidence.series[319],{index:320,value:319/320});
 assert.deepEqual(evidence.site_series,{1:[0,.2],2:[.3,.5]});assert.equal(evidence.threshold,0);assert.equal(evidence.metric,'yield');
 assert.equal(evidence.score,.9);assert.equal(evidence.suggestion,'Inspect bins');assert.equal(evidence.response_status,'response_queued');assert.equal(evidence.tester_receipt_id,null);assert.equal(state.items[0].event.message,'source message');
 assert.deepEqual(evidence.missing_fields,['unit']);assert.equal(evidence.unit,'未確認');
});
test('prediction preserves explicit coverage and receipt without inventing either',()=>{
 const state=receive([prediction(1,{coverage:0,response_status:'response_queued'}),prediction(2,{coverage:1,response_status:'tester_confirmed',tester_receipt_id:'receipt'})]);
 const values=state.items.flatMap(i=>i.predictions).sort((a,b)=>a.site-b.site);
 assert.equal(values[0].coverage,0);assert.equal(values[0].tester_receipt_id,null);assert.equal(values[0].request_id,'request');
 assert.equal(values[1].coverage,1);assert.equal(values[1].tester_receipt_id,'receipt');
 assert.throws(()=>receive([prediction(1,{response_status:'tester_confirmed'})]));
});
test('multi-site joins work out of order in one batch and retry cannot erase actual',()=>{
 let state=receive([actual(2),prediction(1),prediction(2),actual(1)]);
 assert.deepEqual(state.items.flatMap(i=>i.predictions).sort((a,b)=>a.site-b.site).map(p=>p.actual),[1,2]);
 state=receive([prediction(1)],state,'retry');assert.equal(state.items.find(i=>i.predictions[0]?.site===1).predictions[0].actual,1);
 assert.throws(()=>receive([actual(1,{actual:99})],state,'conflict'));
});
test('ambiguous and wrong run/tester/lot/wafer/device/site/stage/attempt/source actuals fail closed',()=>{
 const state=receive([prediction(1,{attempt:1}),prediction(2,{attempt:1})]);
 assert.throws(()=>receive([{...actual(),site_id:undefined,device_id:undefined}],state,'ambiguous'));
 for(const [key,value] of Object.entries({run_id:'other',tester_id:'other',lot_id:'other',wafer_id:'other',device_id:'other',site_id:3,stage:2,attempt:2,source_mode:'replay'}))assert.throws(()=>receive([actual(1,{[key]:value})],state,`wrong-${key}`),key);
});
test('same IDs across run/tester scopes remain distinct',()=>{
 const state=receive([prediction(),prediction(1,{run_id:'r2'}),prediction(1,{tester_id:'t2'})]);
 assert.equal(state.items.length,3);assert.equal(new Set(state.items.map(i=>i.event.event_id)).size,3);
 assert.equal(new Set(state.items.flatMap(i=>i.predictions).map(p=>p.prediction_id)).size,3);
});
test('conflicting evidence and predictions reject atomically',()=>{
 const evidence={...base,type:'evidence',event_id:'e',evidence_id:'proof',current_value:1};
 let state=receive([evidence]);assert.throws(()=>receive([{...evidence,event_id:'e2',current_value:2}],state,'conflict'));
 state=receive([prediction()]);assert.throws(()=>receive([prediction(1,{event_id:'other',prediction:99})],state,'conflict'));
 assert.equal(state.items[0].predictions[0].predicted,0);
});
test('maximum normalized batch converts without clipping records',()=>{
 const state=receive(Array.from({length:100},(_,i)=>prediction(1,{event_id:`e${i}`,request_id:`r${i}`})));
 assert.equal(state.items.length,100);assert.equal(state.items.flatMap(i=>i.predictions).length,100);
});
test('snapshot prediction rows join sites, reject ambiguity and expose conflicting actuals',()=>{
 assert.deepEqual(predictionRows([actual(2),prediction(1),prediction(2),actual(1)]).map(p=>p.actual),[1,2]);
 const ambiguous={...actual(),device_id:undefined,site_id:undefined};
 assert.ok(predictionRows([prediction(1),prediction(2),ambiguous]).every(p=>p.actual===undefined&&p.actual_status));
 assert.equal(predictionRows([prediction(),actual(),actual(1,{event_id:'second',actual:9})])[0].actual_status,'實測衝突');
 for(const [key,value] of Object.entries({run_id:'other',tester_id:'other',lot_id:'other',wafer_id:'other',device_id:'other',site_id:3,source_mode:'replay'}))assert.equal(predictionRows([prediction(),actual(1,{[key]:value})])[0].actual,undefined,key);
 assert.deepEqual(predictionRows([]),[]);
 assert.throws(()=>predictionRows([prediction(),prediction(1,{prediction:8})]));
});
test('source provenance survives conversion and reused actual event IDs cannot change target',()=>{
 const events=[prediction(1),prediction(2),actual(1)];
 const state=receive(events);
 assert.deepEqual(state.batches[0].source_batch.events,events);
 assert.throws(()=>receive([actual(2,{event_id:'a1'})],state,'changed-target'));
 assert.throws(()=>receive([prediction(1,{sequence:99})],state,'changed-provenance'));
});

test('snapshot joins require original request provenance and one distinct actual event',()=>{
 const p=prediction(1,{original_request_id:'original'});
 assert.equal(predictionRows([p,actual(1,{original_request_id:'other'})])[0].actual,undefined);
 const a=actual(1,{original_request_id:'original'});
 assert.equal(predictionRows([p,a])[0].actual,1);
 const row=predictionRows([{...p,actual:1,absolute_error:1},a,{...a,event_id:'second-equal-actual'}])[0];
 assert.equal(row.actual,undefined);assert.equal(row.absolute_error,undefined);assert.equal(row.actual_status,'實測範圍不唯一');
 assert.equal(predictionRows([p,a,a])[0].actual,1);
});
