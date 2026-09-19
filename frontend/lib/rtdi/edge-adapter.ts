import {batchSchema,type Batch,type EventRecord,type PredictionRecord,type Workspace} from "./contracts.ts";
import {uiIdentity} from "./ui-predictions.ts";
import {uiEdgeBatchSchema} from "./ui-wire.ts";

// Incoming v1 proposal from message.txt. This adapter is a UI boundary, not an ingest API.
export function adaptIncoming(input:unknown,state:Workspace):Batch{
 if(input&&typeof input==='object'&&'schema_version' in input&&input.schema_version==='0.1-draft')return batchSchema.parse(input);
 const parsed=uiEdgeBatchSchema.safeParse(input);
 if(!parsed.success)throw Error("格式不符合前端 batch 或 Edge v1。Edge events 至少需要 event_id、type、source_mode、run_id、tester_id、timestamp；時間必須含時區。");
 const packet=parsed.data;const records:Batch['records']=[];
 // Actuals may precede predictions in a normalized batch. Join after collecting predictions.
 for(const r of [...packet.events.filter(e=>e.type!=='prediction_actual'),...packet.events.filter(e=>e.type==='prediction_actual')]){
  const scope={run_id:r.run_id,tester_id:r.tester_id,lot_id:r.lot_id??"未提供",wafer_id:r.wafer_id??"未提供",site:r.site_id??null};
  const event:EventRecord={type:"event",event_id:uiIdentity("event",r.run_id,r.tester_id,r.event_id),occurred_at:r.timestamp,mode:r.source_mode,...scope,severity:r.severity??(r.type==='evidence'?"warning":"info"),kind:r.type==='evidence'?"external_evidence":r.type==='prediction'||r.type==='prediction_actual'?"prediction":r.type==='measurement'?"measurement":r.type,
    message:"",incident_id:r.incident_id?uiIdentity("incident",r.run_id,r.tester_id,r.incident_id):null,evidence_ids:[],data_quality:(!r.run_id||!r.wafer_id||!r.source_mode)?"partial":"complete"};
  if(r.type==='measurement'){
   if(r.value===undefined||!r.test_name)throw Error("measurement 需要 value 與 test_name。");
   const evidenceId=uiIdentity("measurement",r.run_id,r.tester_id,r.event_id);
   event.message=`收到 ${r.test_name} 的單筆觀測 ${r.value} ${r.unit??'（單位未確認）'}。此紀錄本身不是異常判定。`;
   event.evidence_ids=[evidenceId];if(r.quality&&r.quality!=='valid')event.data_quality='partial';
   records.push({type:'evidence',evidence_id:evidenceId,event_id:uiIdentity("event",r.run_id,r.tester_id,r.event_id),...scope,test_name:r.test_name,unit:r.unit||'未確認',sample_count:1,observed:r.value,baseline:null,threshold:null,metric:'measurement',series:[],missing_fields:[]});
  }else if(r.type==='evidence'){
   if(!r.evidence_id)throw Error("evidence 需要 evidence_id。");
   const evidenceId=uiIdentity("evidence",r.run_id,r.tester_id,r.evidence_id);
   event.evidence_ids=[evidenceId];event.message=r.message||`收到 ${r.kind??'未分類異常'} 證據；影響 site：${r.site_ids?.join(', ')??r.site_id??'未提供'}。根因尚未確認。`;
   records.push({type:'evidence',evidence_id:evidenceId,event_id:uiIdentity("event",r.run_id,r.tester_id,r.event_id),...scope,test_name:r.affected_tests?.join(', ').slice(0,200)||'未提供測項',unit:r.unit||'未確認',sample_count:r.sample_count??0,observed:r.current_value??null,baseline:r.baseline??null,threshold:r.threshold??null,metric:r.kind==='low_yield'?'yield':r.kind?.includes('mean')?'mean':'measurement',series:(r.series??[]).map((value,index)=>({index:index+1,value})),...(r.site_series?{site_series:r.site_series}:{}),...(r.score===undefined?{}:{score:r.score}),...(r.suggestion===undefined?{}:{suggestion:r.suggestion}),...(r.response_status===undefined?{}:{response_status:r.response_status}),...(r.tester_receipt_id===undefined?{}:{tester_receipt_id:r.tester_receipt_id}),missing_fields:[...(!r.unit?['unit']:[]),...(!r.affected_tests?.length?['affected_tests']:[]),...(r.series===undefined?['series']:[]),...(r.threshold===undefined?['threshold']:[])]});
   event.data_quality='partial';
  }else if(r.type==='prediction'){
   if(!r.request_id||!r.stage||!r.device_id)throw Error("prediction 需要 request_id、stage、device_id。");
   event.message=`收到第 ${r.stage} 階段預測紀錄。機台是否已接收仍需獨立回執。`;
   records.push({type:'prediction',prediction_id:uiIdentity('prediction',r.run_id,r.tester_id,r.lot_id??null,r.wafer_id??null,r.device_id,r.site_id??null,r.attempt??null,r.request_id),request_id:r.request_id,...(r.original_request_id===undefined?{}:{original_request_id:r.original_request_id}),...(r.source_event_id===undefined?{}:{source_event_id:r.source_event_id}),source_mode:r.source_mode,...(r.attempt===undefined?{}:{attempt:r.attempt}),event_id:uiIdentity("event",r.run_id,r.tester_id,r.event_id),...scope,device_id:r.device_id,stage:r.stage,requested_at:r.timestamp,predicted:r.prediction??null,actual:r.actual??null,unit:r.unit||'未確認',coverage:r.coverage??null,latency_ms:r.latency_ms??null,model_version:r.model_version??'未提供',response_status:r.response_status??'unknown',tester_receipt_id:r.tester_receipt_id??null});
   // Coverage and receipt come only from explicit normalized fields.
   event.data_quality='partial';
  }else if(r.type==='prediction_actual'){
   if(!r.run_id||!r.request_id||r.actual===undefined)throw Error("prediction_actual 需要 run_id、request_id、actual 以避免跨 run 混用。");
   const available=new Map([...state.items.flatMap(i=>i.predictions),...records.filter((p):p is PredictionRecord=>p.type==='prediction')].map(p=>[p.prediction_id,p]));
   const candidates=[...available.values()].filter(p=>(p.request_id??p.prediction_id)===r.request_id&&(p.source_mode===undefined||p.source_mode===r.source_mode)&&(r.attempt===undefined||p.attempt===r.attempt)&&p.run_id===r.run_id&&p.tester_id===r.tester_id&&(r.original_request_id===undefined||p.original_request_id===r.original_request_id)&&(r.lot_id===undefined||p.lot_id===r.lot_id)&&(r.wafer_id===undefined||p.wafer_id===r.wafer_id)&&(r.stage===undefined||p.stage===r.stage)&&(r.site_id===undefined||p.site===r.site_id)&&(r.device_id===undefined||p.device_id===r.device_id));
   if(candidates.length!==1)throw Error("prediction_actual 找不到唯一對應的 request/run/tester，請先接收預測紀錄。");
   if(candidates[0].actual!==null&&candidates[0].actual!==r.actual)throw Error('prediction_actual 的實測內容衝突。');
   records.push({...candidates[0],actual:r.actual});continue;
  }else if(r.type==='heartbeat')event.message='收到 Edge 心跳。這不代表測量串流或機台回執已驗證。';
  else event.message=`收到 wafer 摘要：完成 ${r.completed_devices??'未知'} 顆，良率 ${r.yield===undefined?'未知':(r.yield*100).toFixed(2)+'%'}。`;
  records.push(event);
 }
 return batchSchema.parse({schema_version:'0.1-draft',source_batch:packet,batch_id:uiIdentity("batch",packet.edge_id,packet.batch_id),sent_at:packet.events[0].timestamp,records});
}
