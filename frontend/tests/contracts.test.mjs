import test from 'node:test';
import assert from 'node:assert/strict';
import {batchSchema,ackSchema,predictionSchema,receiveBatch,emptyWorkspace,validatedView} from '../lib/rtdi/contracts.ts';
import {createFixture} from '../lib/rtdi/fixtures.ts';
import {demoAnswer} from '../lib/rtdi/assistant.ts';
const time='2026-09-19T05:30:00.000Z';
test('all synthetic scenarios conform and stage IDs stay in range',()=>{
 for(const kind of ['normal','anomaly','missing']){const batch=batchSchema.parse(createFixture(kind,1,time));const s=receiveBatch(emptyWorkspace(),batch);assert.equal(s.items.length,1);assert.equal(s.items[0].predictions.length,6);}
});
test('identical retry and new-batch retry never create a second incident',()=>{
 const b=createFixture('anomaly',1,time);let s=receiveBatch(emptyWorkspace(),b);s=receiveBatch(s,b);assert.equal(s.items.length,1);assert.equal(s.duplicateCount,1);
 s=receiveBatch(s,{...b,batch_id:'retry-new-envelope'});assert.equal(s.items.length,1);assert.equal(s.duplicateCount,2);assert.equal(s.receivedCount,1);
});
test('conflicting batch or event identity is rejected atomically',()=>{
 const b=createFixture('anomaly',1,time),s=receiveBatch(emptyWorkspace(),b),changed=structuredClone(b);changed.records[0].message='different';
 assert.throws(()=>receiveBatch(s,changed));changed.batch_id='new-batch';assert.throws(()=>receiveBatch(s,changed));assert.equal(s.items[0].event.message,b.records[0].message);
});
test('wrong site/run evidence is excluded and cannot reach AI context',()=>{
 const b=createFixture('anomaly',1,time);b.records[1].run_id='wrong-run';const s=receiveBatch(emptyWorkspace(),b);assert.equal(s.items[0].evidence.length,0);
 const v=validatedView({...s.items[0],evidence:[b.records[1]]});assert.equal(v.evidence.length,0);
});
test('late evidence enriches the existing event',()=>{
 const b=createFixture('anomaly',1,time);let s=receiveBatch(emptyWorkspace(),{...b,records:[b.records[0]]});assert.equal(s.items[0].evidence.length,0);
 s=receiveBatch(s,{...b,batch_id:'later-evidence',records:[b.records[1]]});assert.equal(s.items.length,1);assert.equal(s.items[0].evidence.length,1);
});
test('tester confirmation requires an explicit receipt reference',()=>{
 const ack={type:'command_ack',ack_id:'a',command_id:'c',run_id:'r',tester_id:'t',status:'tester_confirmed',occurred_at:time,tester_receipt_id:null,detail:''};assert.equal(ackSchema.safeParse(ack).success,false);
 const prediction=createFixture('normal',1,time).records[2];assert.equal(predictionSchema.safeParse({...prediction,response_status:'tester_confirmed'}).success,false);
 assert.equal(ackSchema.safeParse({...ack,tester_receipt_id:'receipt-001'}).success,true);
});
test('missing features produce no invented temperatures or normal claims',()=>{
 const v=receiveBatch(emptyWorkspace(),createFixture('missing',1,time)).items[0];assert.ok(v.predictions.every(p=>p.predicted===null));assert.match(demoAnswer(v,'分析'),/Insufficient data/);
});
test('AI explanation never changes command state or claims tester delivery',()=>{
 const v=receiveBatch(emptyWorkspace(),createFixture('anomaly',1,time)).items[0];const before=JSON.stringify(v);assert.match(demoAnswer(v,'機台收到訊息了嗎？'),/unconfirmed/);assert.equal(JSON.stringify(v),before);
});
test('invalid schema and non-finite measurements are rejected',()=>{
 const b=createFixture('anomaly',1,time);b.records[1].observed=NaN;assert.equal(batchSchema.safeParse(b).success,false);assert.equal(batchSchema.safeParse({records:[]}).success,false);
});

const {adaptIncoming}=await import('../lib/rtdi/edge-adapter.ts');
test('wire v1 measurement is displayed without pretending to be an anomaly',()=>{
 const b={schema_version:1,edge_id:'group-6',batch_id:'wire',events:[{event_id:'wire-1',type:'measurement',source_mode:'simulation',run_id:'r',tester_id:'t',timestamp:time,test_name:'Main.demo',value:1.2}]};
 const s=receiveBatch(emptyWorkspace(),adaptIncoming(b,emptyWorkspace()));assert.equal(s.items[0].event.kind,'measurement');assert.equal(s.items[0].evidence[0].unit,'未確認');assert.equal(s.items[0].evidence[0].threshold,null);
});
test('wire actual joins only the matching run and never invents receipt or coverage',()=>{
 const base={schema_version:1,edge_id:'group-6',batch_id:'wire-pred',events:[{event_id:'pred-evt',type:'prediction',request_id:'req-1',source_mode:'simulation',run_id:'r',tester_id:'t',device_id:'d',wafer_id:'w',site_id:2,timestamp:time,stage:3,prediction:0}]};
 let s=receiveBatch(emptyWorkspace(),adaptIncoming(base,emptyWorkspace()));assert.equal(s.items[0].predictions[0].coverage,null);assert.equal(s.items[0].predictions[0].response_status,'unknown');
 const actual={...base,batch_id:'wire-actual',events:[{event_id:'actual-evt',type:'prediction_actual',request_id:'req-1',source_mode:'simulation',run_id:'r',tester_id:'t',timestamp:time,actual:0}]};
 s=receiveBatch(s,adaptIncoming(actual,s));assert.equal(s.items[0].predictions[0].actual,0);assert.equal(s.items[0].predictions[0].predicted,0);
 assert.throws(()=>adaptIncoming({...actual,batch_id:'wrong-run',events:[{...actual.events[0],run_id:'other'}]},s));
});
