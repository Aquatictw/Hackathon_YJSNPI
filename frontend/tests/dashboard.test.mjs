import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshot,runUrl} from '../lib/rtdi/dashboard.ts';
const run={run_id:'r1',tester_id:'t1',edge_id:'e1',mode:'replay',lot_id:null,wafer_id:null,data_quality:'partial',last_event_at:'2026-09-19T00:00:00Z'};
const event={event_id:'e1',type:'heartbeat',source_mode:'replay',run_id:'r1',tester_id:'t1',timestamp:'2026-09-19T00:00:00Z'};
const snapshot={run,events:[event],evidence:[],incidents:[],commands:[]};
test('snapshot rejects cross-run and cross-tester records',()=>{
 assert.equal(parseSnapshot(snapshot,'r1','t1').events.length,1);
 assert.throws(()=>parseSnapshot(snapshot,'r2','t1'));
 assert.throws(()=>parseSnapshot({...snapshot,events:[{...event,tester_id:'t2'}]},'r1','t1'));
 assert.throws(()=>parseSnapshot({...snapshot,commands:[{command_id:'c',run_id:'r2',tester_id:'t1',incident_id:'i',kind:'show_message',message:'hi',status:'queued',expires_at:'x',created_at:'x',updated_at:'x'}]},'r1','t1'));
});
test('unknown provenance is not inferred as live and absent evidence remains absent',()=>{
 assert.throws(()=>parseSnapshot({...snapshot,run:{...run,mode:'unknown'}},'r1'));
 assert.equal(parseSnapshot(snapshot,'r1').evidence.length,0);
});
test('run URL encodes identifiers without permitting route or query injection',()=>{
 assert.equal(runUrl('a/b','x&other=1','/events'),'/api/v1/runs/a%2Fb/events?tester_id=x%26other%3D1');
});
test('snapshot rejects same event ID with changed content across projections',()=>{
 assert.throws(()=>parseSnapshot({...snapshot,evidence:[{...event,source_mode:'live'}]},'r1','t1'));
 assert.equal(parseSnapshot({...snapshot,evidence:[event]},'r1','t1').evidence.length,1);
});
