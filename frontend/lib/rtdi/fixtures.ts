import type { Batch, EventRecord, EvidenceRecord, PredictionRecord } from "./contracts";
export type Scenario="anomaly"|"normal"|"missing"|"duplicate";
export const scenarioLabels:Record<Scenario,string>={anomaly:"均值偏移",normal:"正常事件",missing:"缺少資料",duplicate:"重送上一批"};
const scope={run_id:"DEMO-RUN-001",tester_id:"grp6-demo-tester",lot_id:"DEMO-LOT-A",wafer_id:"DEMO-W14",site:2};
const trend=[1.01,1.02,1,1.03,1.02,1.04,1.03,1.05,1.04,1.06,1.06,1.08,1.07,1.09,1.08,1.11,1.12,1.1,1.14,1.13,1.16,1.15,1.18,1.2,1.19,1.22,1.23,1.25,1.24,1.27,1.26,1.29];
export function createFixture(kind:Exclude<Scenario,"duplicate">="anomaly",sequence=1,timestamp=new Date().toISOString()):Batch{
  const suffix=`${kind}-${sequence}`;const eventId=`demo-event-${suffix}`;const evidenceId=`demo-evidence-${suffix}`;const abnormal=kind==="anomaly";const missing=kind==="missing";
  const event:EventRecord={type:"event",event_id:eventId,occurred_at:timestamp,mode:"simulation",...scope,
    severity:abnormal?"warning":"info",kind:abnormal?"mean_drift":missing?"missing_data":"normal",
    message:abnormal?"Site 2 最近 32 筆測試結果呈上升趨勢，窗口均值高於示範門檻。":missing?"第 3 階段預測缺少 8 個輸入特徵，本次不產生預測值。":"Site 2 最近 32 筆結果落在示範監測範圍內。",
    incident_id:abnormal?`demo-incident-${suffix}`:null,evidence_ids:[evidenceId],data_quality:missing?"partial":"complete"};
  const values=abnormal?trend:trend.map((_,i)=>1+(i%5-2)*.006);
  const evidence:EvidenceRecord={type:"evidence",evidence_id:evidenceId,event_id:eventId,...scope,test_name:"Main.subflow3.demo_parametric#CP",unit:missing?"ratio":"a.u.",sample_count:missing?24:32,
    observed:missing?.75:Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(4)),baseline:missing?1:1.01,threshold:missing?1:1.08,metric:missing?"coverage":"mean",
    series:missing?[]:values.map((value,i)=>({index:i+1,value})),missing_fields:missing?Array.from({length:8},(_,i)=>`demo_feature_${i+25}`):[]};
  const predictions:PredictionRecord[]=Array.from({length:6},(_,i)=>({type:"prediction",prediction_id:`demo-prediction-${suffix}-${i+1}`,event_id:eventId,...scope,device_id:"DEMO-D032",stage:i+1,requested_at:timestamp,
    predicted:missing?null:[25.12,25.31,25.49,25.66,25.87,26.05][i],actual:missing?null:[25.14,25.29,25.51,25.64,25.9,26.02][i],unit:"°C (示範)",coverage:missing?(i===2?.75:0):1,
    latency_ms:missing?null:[1.2,1.4,1.1,1.6,1.3,1.5][i],model_version:"demo-only",response_status:missing?(i===2?"insufficient_data":"not_requested"):"response_queued",tester_receipt_id:null}));
  return {schema_version:"0.1-draft",batch_id:`demo-batch-${suffix}`,sent_at:timestamp,records:[event,evidence,...predictions,...(abnormal?[{type:"incident" as const,incident_id:event.incident_id!,...scope,title:"Site 2 測試均值持續上升",status:"open" as const,severity:"warning" as const,event_ids:[eventId],evidence_ids:[evidenceId],first_seen:timestamp}]:[])]};
}
