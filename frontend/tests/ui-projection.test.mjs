import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uiEdgeRecordSchema,uiEdgeBatchSchema} from '../lib/rtdi/ui-wire.ts';
import {adaptIncoming} from '../lib/rtdi/edge-adapter.ts';
import {emptyWorkspace,receiveBatch} from '../lib/rtdi/contracts.ts';
import {parseSnapshot} from '../lib/rtdi/dashboard.ts';
import {predictionRows} from '../lib/rtdi/ui-predictions.ts';
const time='2026-09-19T00:00:00Z';
// D 2085284 projection shape; synthetic values, not live receipt evidence.
const prediction=site=>({event_id:`projection-p${site}`,type:'prediction',source_mode:'simulation',run_id:'run',tester_id:'tester',lot_id:'lot',wafer_id:'1',timestamp:time,request_id:`request:site:${site}`,original_request_id:'request',source_event_id:'request-event',device_id:`device-${site}`,site_id:site,stage:2,prediction:site===1?1.2:null,coverage:site===1?1:0,unit:null,response_status:'response_queued'});
const actual=site=>({...prediction(site),event_id:`projection-a${site}`,type:'prediction_actual',source_event_id:`actual-event-${site}`,actual:1.3});
const batch=(events,batch_id='projection')=>({schema_version:1,edge_id:'edge',batch_id,events});
const snapshot=events=>({run:{run_id:'run',tester_id:'tester',edge_id:'edge',mode:'simulation',lot_id:'lot',wafer_id:'1',data_quality:'partial',last_event_at:time},events,evidence:[],commands:[],incidents:[]});

test('D projections retain both provenance IDs through snapshot, rows and workspace',()=>{
 const events=[actual(1),prediction(2),prediction(1)];
 const parsed=parseSnapshot(snapshot(events),'run','tester');
 const rows=predictionRows(parsed.events);
 assert.equal(rows.find(p=>p.site_id===1).actual,1.3);
 assert.equal(rows.find(p=>p.site_id===2).prediction,null);
 assert.equal(rows.find(p=>p.site_id===2).actual,undefined);
 const state=receiveBatch(emptyWorkspace(),adaptIncoming(batch(events),emptyWorkspace()));
 const projected=state.items.flatMap(item=>item.predictions).find(p=>p.site===1);
 assert.equal(projected.request_id,'request:site:1');
 assert.equal(projected.original_request_id,'request');assert.equal(projected.source_event_id,'request-event');
 assert.equal(projected.actual,1.3);assert.equal(projected.unit,'未確認');assert.equal(projected.tester_receipt_id,null);
 assert.deepEqual(state.batches[0].source_batch.events,events);
});
test('original request mismatch never joins despite matching per-site IDs',()=>{
 const p=prediction(1),a={...actual(1),original_request_id:'other-request'};
 assert.equal(predictionRows([p,a])[0].actual,undefined);
 assert.throws(()=>adaptIncoming(batch([p,a]),emptyWorkspace()));
});
test('snapshot-added actuals survive without fabricating missing actuals',()=>{
 const rows=predictionRows(parseSnapshot(snapshot([{...prediction(1),actual:1.3,absolute_error:.1},prediction(2)]),'run','tester').events);
 assert.equal(rows[0].actual,1.3);assert.equal(rows[0].absolute_error,.1);assert.equal(rows[1].actual,undefined);
});
test('compatibility validation preserves strict wire semantics and identity constraints',()=>{
 for(const field of ['original_request_id','source_event_id'])for(const value of ['',null,7,'x'.repeat(121)])assert.equal(uiEdgeRecordSchema.safeParse({...prediction(1),[field]:value}).success,false);
 for(const change of [{unexpected:'ignored?'},{device_id:undefined},{stage:7},{timestamp:'not-a-time'},{prediction:Infinity},{response_status:'tester_confirmed',tester_receipt_id:null}])assert.equal(uiEdgeRecordSchema.safeParse({...prediction(1),...change}).success,false);
 assert.equal(uiEdgeBatchSchema.safeParse(batch([prediction(1),prediction(1)])).success,false);
 assert.equal(uiEdgeBatchSchema.safeParse(batch([])).success,false);
 assert.equal(uiEdgeBatchSchema.safeParse({...batch([prediction(1)]),unexpected:true}).success,false);
 const evidence={...prediction(1),type:'evidence',evidence_id:'proof'};
 assert.equal(uiEdgeBatchSchema.safeParse(batch([evidence,{...evidence,event_id:'other'}])).success,false);
});
test('changed provenance on reused source identity is rejected atomically',()=>{
 const initial=batch([prediction(1)]),state=receiveBatch(emptyWorkspace(),adaptIncoming(initial,emptyWorkspace()));
 const changed=batch([{...prediction(1),source_event_id:'other-source'}],'changed');
 assert.throws(()=>receiveBatch(state,adaptIncoming(changed,state)));
 assert.equal(state.items[0].predictions[0].source_event_id,'request-event');
});
test('published UI source schema retains wire constraints and D provenance additions',()=>{
 const ui=JSON.parse(readFileSync(new URL('../contracts/schemas.json',import.meta.url)));
 const wire=JSON.parse(readFileSync(new URL('../contracts/edge-v1.schema.json',import.meta.url)));
 for(const field of ['original_request_id','source_event_id'])wire.$defs.event.properties[field]={$ref:'#/$defs/id'};
 const { $id,$comment,title,...documented}=ui.$defs.ui_edge_batch;
 const { $id:wireId,title:wireTitle,...expected}=wire;
 assert.deepEqual(documented,expected);
 assert.equal(ui.$defs.batch.properties.source_batch.$ref,'#/$defs/ui_edge_batch');
});

// Optional cross-branch check: load D's published modules from git objects in
// memory. No working-tree overlay, merge, backend mutation, network, or VM use.
if(process.env.GRP6_D_REVISION)test('published D projector interoperates with E without merging branches',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {stripTypeScriptTypes}=await import('node:module');
 const revision=process.env.GRP6_D_REVISION;
 assert.match(revision,/^[a-f0-9]{40}$/);
 const read=path=>execFileSync('git',['show',`${revision}:frontend/lib/rtdi/${path}`],{encoding:'utf8'});
 const moduleUrl=code=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64');
 const wireUrl=moduleUrl(read('wire.ts').replace('"zod"',JSON.stringify(import.meta.resolve('zod'))));
 const code=read('backend-projection.ts').replace('"zod"',JSON.stringify(import.meta.resolve('zod'))).replace('"./wire.ts"',JSON.stringify(wireUrl));
 const {projectExporterEvents,joinPredictionActuals}=await import(moduleUrl(code));
 const common={run_id:'run',tester_id:'tester',lot_id:'lot',wafer_id:'1',source_mode:'simulation',timestamp:time};
 const sources=[{...common,event_id:'source-request',type:'run_summary'},{...common,event_id:'source-actual',type:'run_summary'}];
 const raw=[{run_id:'run',tester_id:'tester',event_id:'source-request',event_type:'prediction_request',payload:{request_id:'request',stage:2,device_ids:{1:'d1',2:'d2'},prediction_ids:{1:'req:s1',2:'req:s2'},predictions:{1:1.2},coverage:{1:1,2:0},status:'response_queued'}},{run_id:'run',tester_id:'tester',event_id:'source-actual',event_type:'prediction_actual',payload:{request_id:'request',prediction_id:'req:s1',device_id:'d1',site:1,stage:2,actual:1.3}}];
 const projected=await projectExporterEvents(raw,sources);assert.equal(projected.length,3);
 const packet=batch([...sources,...projected]);
 const state=receiveBatch(emptyWorkspace(),adaptIncoming(packet,emptyWorkspace()));
 const first=state.items.flatMap(i=>i.predictions).find(p=>p.site===1);
 assert.equal(first.actual,1.3);assert.equal(first.original_request_id,'request');assert.equal(first.source_event_id,'source-request');assert.equal(first.unit,'未確認');assert.equal(first.tester_receipt_id,null);
 const rows=predictionRows(parseSnapshot(snapshot(joinPredictionActuals(packet.events)),'run','tester').events);
 assert.equal(rows.find(p=>p.site_id===1).actual,1.3);
 assert.equal(rows.find(p=>p.site_id===2).prediction,null);assert.equal(rows.find(p=>p.site_id===2).actual,undefined);
});
