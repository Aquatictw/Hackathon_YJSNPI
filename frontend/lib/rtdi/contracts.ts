import { z } from "zod";
import {canonicalJson} from "./wire.ts";
import {uiEdgeBatchSchema} from "./ui-wire.ts";

const id = z.string().min(1).max(120);
// UI-only compound identities retain the full scoped wire identity without hashing.
const recordId = z.string().min(1).max(8192);
const scope = { run_id:id, tester_id:id, lot_id:id, wafer_id:id, site:z.number().int().min(1).max(256).nullable() };
const stamp = z.string().datetime({ offset:true });
const finite = z.number().finite();
export const eventSchema=z.object({
  type:z.literal("event"), event_id:recordId, occurred_at:stamp, mode:z.enum(["simulation","replay","live"]),
  ...scope, severity:z.enum(["info","warning","critical"]), kind:z.enum(["normal","mean_drift","low_yield","missing_data","measurement","prediction","external_evidence","heartbeat","run_summary"]),
  message:z.string().min(1).max(2000), incident_id:recordId.nullable(), evidence_ids:z.array(recordId).max(20),
  data_quality:z.enum(["complete","partial"]),
}).strict();
export const evidenceSchema=z.object({
  type:z.literal("evidence"), evidence_id:recordId, event_id:recordId, ...scope,
  test_name:z.string().min(1).max(200), unit:z.string().min(1).max(32), sample_count:z.number().int().nonnegative(),
  observed:finite.nullable(), baseline:finite.nullable(), threshold:finite.nullable(),
  metric:z.enum(["mean","yield","coverage","measurement"]),
  series:z.array(z.object({ index:z.number().int().nonnegative(),value:finite }).strict()).max(320),
  score:finite.optional(), suggestion:z.string().max(1000).optional(),
  response_status:z.enum(["not_requested","insufficient_data","response_queued","tester_confirmed","unknown"]).optional(),
  tester_receipt_id:id.nullable().optional(),
  site_series:z.record(z.string(),z.array(finite).max(320)).optional(),
  missing_fields:z.array(z.string().max(120)).max(32),
}).strict().refine(e=>e.response_status!=="tester_confirmed"||!!e.tester_receipt_id,{message:"Tester confirmation requires receipt evidence"});
export const predictionSchema=z.object({
  type:z.literal("prediction"), prediction_id:recordId, event_id:recordId, ...scope,
  request_id:id.optional(), original_request_id:id.optional(), source_event_id:id.optional(), source_mode:z.enum(["simulation","replay","live"]).optional(), attempt:z.number().int().positive().optional(),
  device_id:id, stage:z.number().int().min(1).max(6), requested_at:stamp,
  predicted:finite.nullable(), actual:finite.nullable(), unit:z.string().max(32),
  coverage:z.number().min(0).max(1).nullable(), latency_ms:z.number().nonnegative().nullable(),model_version:id,
  response_status:z.enum(["not_requested","insufficient_data","response_queued","tester_confirmed","unknown"]),
  tester_receipt_id:id.nullable(),
}).strict().refine(p=>p.response_status!=="tester_confirmed"||!!p.tester_receipt_id,{message:"Tester confirmation requires receipt evidence"});
export const incidentSchema=z.object({
  type:z.literal("incident"),incident_id:recordId,...scope,title:z.string().min(1).max(160),
  status:z.enum(["open","investigating","resolved"]),severity:z.enum(["warning","critical"]),
  event_ids:z.array(recordId).min(1).max(40),evidence_ids:z.array(recordId).max(40),first_seen:stamp,
}).strict();
export const commandSchema=z.object({
  command_id:id,run_id:id,tester_id:id,kind:z.literal("tester_message"),
  incident_id:recordId,message:z.string().min(1).max(500),created_at:stamp,expires_at:stamp,
}).strict().refine(c=>Date.parse(c.expires_at)>Date.parse(c.created_at),{message:"Command expiry must follow creation"});
export const ackSchema=z.object({
  type:z.literal("command_ack"),ack_id:id,command_id:id,run_id:id,tester_id:id,
  status:z.enum(["received","queued_to_tester","tester_confirmed","rejected","failed","expired"]),
  occurred_at:stamp,tester_receipt_id:id.nullable(),detail:z.string().max(500),
}).strict().refine(a=>a.status!=="tester_confirmed"||!!a.tester_receipt_id,{message:"Tester confirmation requires receipt evidence"});
export const batchSchema=z.object({
  schema_version:z.literal("0.1-draft"),batch_id:recordId,sent_at:stamp,
  source_batch:uiEdgeBatchSchema.optional(),
  records:z.array(z.union([eventSchema,evidenceSchema,predictionSchema,incidentSchema,ackSchema])).min(1).max(200),
}).strict();
export type EventRecord=z.infer<typeof eventSchema>;
export type EvidenceRecord=z.infer<typeof evidenceSchema>;
export type PredictionRecord=z.infer<typeof predictionSchema>;
export type Batch=z.infer<typeof batchSchema>;
export type EventView={event:EventRecord;evidence:EvidenceRecord[];predictions:PredictionRecord[];incident:z.infer<typeof incidentSchema>|null};
export type Workspace={batches:Batch[];items:EventView[];duplicateCount:number;receivedCount:number};
export const emptyWorkspace=():Workspace=>({batches:[],items:[],duplicateCount:0,receivedCount:0});
// A batch is atomic. New evidence for an existing event is allowed in later batches.
export function receiveBatch(state:Workspace,input:unknown):Workspace{
  const batch=batchSchema.parse(input);
  const oldBatch=state.batches.find(b=>b.batch_id===batch.batch_id);
  if(oldBatch){if(canonicalJson(oldBatch.records)!==canonicalJson(batch.records)||canonicalJson(oldBatch.source_batch)!==canonicalJson(batch.source_batch))throw new Error("相同 batch_id 的內容已改變，請勿覆寫既有批次。");return {...state,duplicateCount:state.duplicateCount+batch.records.filter(r=>r.type==="event").length};}
  const batches=[...state.batches,batch].slice(-100);
  // Retain normalized provenance, including actual events that enrich existing rows.
  const sourceEvents=new Map<string,string>();
  for(const source of batches.flatMap(b=>b.source_batch?.events??[])){
    const key=canonicalJson([source.run_id,source.tester_id,source.event_id]);
    const content=canonicalJson(source);
    if(sourceEvents.has(key)&&sourceEvents.get(key)!==content)throw Error('相同來源 event_id 的內容衝突。');
    sourceEvents.set(key,content);
  }
  const all=batches.flatMap(b=>b.records);
  const events=new Map<string,EventRecord>();
  for(const r of all)if(r.type==="event"){
    const previous=events.get(r.event_id);
    if(previous&&canonicalJson(previous)!==canonicalJson(r))throw new Error("相同 event_id 帶有不同內容，請使用新的事件 ID。");
    events.set(r.event_id,r);
  }
  const uniqueEvidence=new Map<string,EvidenceRecord>();
  const uniquePredictions=new Map<string,PredictionRecord>();
  for(const r of all){
    if(r.type==='evidence'){
      const old=uniqueEvidence.get(r.evidence_id);
      if(old&&canonicalJson(old)!==canonicalJson(r))throw Error('相同 evidence_id 的內容衝突。');
      uniqueEvidence.set(r.evidence_id,r);
    }
    if(r.type==='prediction'){
      const old=uniquePredictions.get(r.prediction_id);
      if(old){
        const {actual:oldActual,...before}=old;const {actual,...after}=r;
        if(canonicalJson(before)!==canonicalJson(after)||(oldActual!==null&&actual!==null&&oldActual!==actual))throw Error('相同 prediction_id 的內容衝突。');
        if(oldActual!==null&&actual===null)continue; // A retry cannot erase a joined actual.
      }
      uniquePredictions.set(r.prediction_id,r);
    }
  }
  const sameScope=(a:EventRecord,b:EvidenceRecord|PredictionRecord)=>a.run_id===b.run_id&&a.tester_id===b.tester_id&&a.lot_id===b.lot_id&&a.wafer_id===b.wafer_id&&a.site===b.site;
  const items=[...events.values()].reverse().map(event=>({event,
    evidence:[...uniqueEvidence.values()].filter(r=>r.event_id===event.event_id&&event.evidence_ids.includes(r.evidence_id)&&sameScope(event,r)),
    predictions:[...uniquePredictions.values()].filter(r=>r.event_id===event.event_id&&sameScope(event,r)),
    incident:all.find(r=>r.type==="incident"&&r.incident_id===event.incident_id&&r.run_id===event.run_id&&r.tester_id===event.tester_id&&r.event_ids.includes(event.event_id)) as z.infer<typeof incidentSchema>|undefined ?? null,
  }));
  const oldIds=new Set(state.items.map(i=>i.event.event_id));
  const incoming=[...new Map(batch.records.filter(r=>r.type==="event").map(e=>[e.event_id,e])).values()];
  return {batches,items,receivedCount:state.receivedCount+incoming.filter(e=>!oldIds.has(e.event_id)).length,
    duplicateCount:state.duplicateCount+incoming.filter(e=>oldIds.has(e.event_id)).length};
}
export function validatedView(input:unknown):EventView{
  const candidate=z.object({event:eventSchema,evidence:z.array(evidenceSchema).max(20),predictions:z.array(predictionSchema).max(6),incident:incidentSchema.nullable()}).strict().parse(input);
  const batch:Batch={schema_version:"0.1-draft",batch_id:"request-context",sent_at:new Date().toISOString(),records:[candidate.event,...candidate.evidence,...candidate.predictions,...(candidate.incident?[candidate.incident]:[])]};
  return receiveBatch(emptyWorkspace(),batch).items[0];
}
