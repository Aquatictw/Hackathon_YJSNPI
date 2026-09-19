import type {EdgeRecord} from './wire.ts';
import {canonicalJson} from './wire.ts';

// Preserve scope and request provenance without depending on globally unique SDK IDs.
export const uiIdentity=(kind:string,...parts:unknown[])=>JSON.stringify([kind,...parts]);
export const predictionLabels={not_requested:'未請求',insufficient_data:'資料不足',response_queued:'回覆已排隊 · 機台未確認',tester_confirmed:'來源回報機台確認',unknown:'未知'};

export function predictionRows(events:EdgeRecord[]){
 const unique=new Map<string,EdgeRecord>();
 for(const event of events){
  const key=uiIdentity('event',event.run_id,event.tester_id,event.event_id);
  const old=unique.get(key);
  if(old&&canonicalJson(old)!==canonicalJson(event))throw Error('相同事件 ID 的內容衝突。');
  unique.set(key,event);
 }
 const records=[...unique.values()];
 return records.filter(e=>e.type==='prediction').map(prediction=>{
  const actuals=records.filter(a=>a.type==='prediction_actual'&&matchesPrediction(a,prediction));
  const unambiguous=actuals.filter(a=>records.filter(p=>p.type==='prediction'&&matchesPrediction(a,p)).length===1);
  const values=new Set(unambiguous.map(a=>a.actual));
  const conflict=values.size>1||(prediction.actual!==undefined&&values.size===1&&!values.has(prediction.actual));
  const ambiguous=actuals.length>1||actuals.length!==unambiguous.length;
  const joined=conflict||ambiguous?undefined:prediction.actual??unambiguous[0]?.actual;
  return {...prediction,actual:joined,absolute_error:joined===undefined?undefined:prediction.absolute_error,actual_status:conflict?'實測衝突':ambiguous?'實測範圍不唯一':undefined};
 });
}
export function matchesPrediction(actual:EdgeRecord,prediction:EdgeRecord){
 return actual.request_id===prediction.request_id&&actual.run_id===prediction.run_id&&actual.tester_id===prediction.tester_id&&actual.source_mode===prediction.source_mode&&
  (['lot_id','wafer_id','device_id','site_id','stage','attempt','original_request_id'] as const).every(key=>actual[key]===undefined||actual[key]===prediction[key]);
}
