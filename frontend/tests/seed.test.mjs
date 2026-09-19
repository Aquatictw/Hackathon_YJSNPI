// A-owned integration tests for the committed preview seed and ingest script.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {predictionSeedBatches,validateSeedAck} from '../scripts/seed-support.mjs';
import {normalizeExporterBatch} from '../lib/rtdi/exporter-wire.ts';
import {projectExporterEvents,joinPredictionActuals} from '../lib/rtdi/backend-projection.ts';
import {predictionRows} from '../lib/rtdi/ui-predictions.ts';
import {measurementPage} from '../lib/rtdi/backend-measurements.ts';
const source=readFileSync(new URL('../../results/replay/predictions.jsonl',import.meta.url),'utf8');

test('committed replay projects 24 complete joins across six stages and four sites',async()=>{
  const [batch]=await predictionSeedBatches(source);
  assert.deepEqual([batch],await predictionSeedBatches(source));
  const normalized=normalizeExporterBatch(batch);
  const projections=await projectExporterEvents(normalized.rawEvents,normalized.batch.events);
  const rows=predictionRows(joinPredictionActuals([...normalized.batch.events,...projections]));
  assert.equal(rows.length,24);
  assert.equal(new Set(rows.map(r=>r.site_id)).size,4);
  assert.equal(new Set(rows.map(r=>r.stage)).size,6);
  for(const row of rows){
    assert.ok(Number.isFinite(row.actual)); assert.ok(Number.isFinite(row.prediction));
    assert.equal(row.source_mode,'replay'); assert.equal(row.unit,null);
    assert.equal(row.response_status,'unknown'); assert.equal(row.tester_receipt_id,undefined);
    assert.equal(row.absolute_error,Math.abs(row.prediction-row.actual));
  }
  for(const bundle of batch.events.filter(e=>e.event_type==='device_completed')){
    const page=measurementPage(bundle,0,100);
    assert.ok(page.total>0); assert.equal(page.metadata.data_quality,'partial');
    assert.ok(page.measurements.every(m=>m.unit===null));
  }
});
test('seed rejects live or unexpected run scope before transport',async()=>{
  const event=JSON.parse(source.split('\n')[0]);
  await assert.rejects(predictionSeedBatches(JSON.stringify({...event,mode:'live'})),/replay scope/);
  await assert.rejects(predictionSeedBatches(JSON.stringify({...event,run_id:'real-run'})),/replay scope/);
});
test('seed ACK validation accepts exact retries and rejects omitted, duplicate, unknown or rejected IDs',()=>{
  const batch={events:[{event_id:'a'},{event_id:'b'}]};
  validateSeedAck(batch,{accepted:['a'],duplicates:['b'],rejected:[]});
  validateSeedAck(batch,{accepted:[],duplicates:['b','a'],rejected:[]});
  for(const body of [null,{accepted:['a'],duplicates:[],rejected:[]},{accepted:['a'],duplicates:['a'],rejected:[]},
    {accepted:['a','c'],duplicates:[],rejected:[]},{accepted:['a','b'],duplicates:[],rejected:[{event_id:'b'}]}])
    assert.throws(()=>validateSeedAck(batch,body));
});
