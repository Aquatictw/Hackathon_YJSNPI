"use client";
import {useLocale} from "@/components/locale-provider";
import {AppHeader} from '@/components/app-header';
import { z } from "zod";
import { useCallback,useEffect,useRef,useState } from "react";
import { Activity, ArrowUpRight, Bell, Check, ChevronRight, CircleDashed, ClipboardList, Copy, Cpu, FileJson2, FlaskConical, Info, LoaderCircle, Radio, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect,NativeSelectOption } from "@/components/ui/native-select";
import { Tabs,TabsList,TabsTrigger,TabsContent } from "@/components/ui/tabs";
import { Alert,AlertDescription } from "@/components/ui/alert";
import { batchSchema,emptyWorkspace,receiveBatch,type Batch,type EvidenceRecord,type EventView,type Workspace } from "@/lib/rtdi/contracts";
import { adaptIncoming } from "@/lib/rtdi/edge-adapter";
import { createFixture,scenarioLabels,type Scenario } from "@/lib/rtdi/fixtures";
import type { ChatMessage } from "@/lib/rtdi/assistant";

type Reply=ChatMessage&{mode?:"demo"|"openai";model?:string|null};
const kindLabels={normal:"Normal observation",mean_drift:"Mean shift",low_yield:"Low yield",missing_data:"Insufficient data",measurement:"Measurement",prediction:"Prediction",external_evidence:"External alert evidence",heartbeat:"Edge heartbeat",run_summary:"Wafer summary"};
const modeLabels={simulation:"Synthetic fixture",replay:"Replay",live:"Source marked live · unverified"};
const responseLabels={unknown:"Unverified",not_requested:"Not requested",insufficient_data:"Missing data",response_queued:"Response queued",tester_confirmed:"Receipt supplied"};
const scenarioDisplayLabels:Record<Scenario,string>={anomaly:"Mean shift",normal:"Normal fixture",missing:"Missing data",duplicate:"Repeat previous batch"};
const prompts=["What does this alert indicate?","What should be checked next?","Is tester receipt confirmed (ACK)?"];
type PracticeScenario = "healthy" | "site" | "drift" | "missing";
type PracticeText = {en:string; "zh-TW":string};
const practiceText=(en:string,zh:string):PracticeText=>({en,"zh-TW":zh});
type FixtureScenario=Exclude<Scenario,"duplicate">;
const fixtureMessages:Record<FixtureScenario,PracticeText>={
 anomaly:practiceText("The latest 32 test results at site 2 show an upward trend; the window mean exceeds the demonstration threshold.","Site 2 最近 32 筆測試結果呈上升趨勢，窗口均值高於示範門檻。"),
 normal:practiceText("The latest 32 results at site 2 are within the demonstration monitoring range.","Site 2 最近 32 筆結果落在示範監測範圍內。"),
 missing:practiceText("Stage 3 is missing 8 input features; no prediction is produced for this request.","第 3 階段預測缺少 8 個輸入特徵，本次不產生預測值。"),
};
const fixtureTitle=practiceText("Site 2 test mean continues to rise","Site 2 測試均值持續上升");
const fixtureUnit=practiceText("°C (demonstration)","°C (示範)");
function createSandboxFixture(kind:FixtureScenario,sequence:number,locale:"en"|"zh-TW"):Batch{
 const batch=createFixture(kind,sequence);
 for(const record of batch.records){
  if(record.type==="event")record.message=fixtureMessages[kind][locale];
  if(record.type==="incident")record.title=fixtureTitle[locale];
  if(record.type==="prediction")record.unit=fixtureUnit[locale];
 }
 return batch;
}
// Sandbox-only teaching data and copy. No evaluation wafers or machine data are used.
const practiceCases:Record<PracticeScenario,{title:PracticeText;description:PracticeText;questions:PracticeText[];answer:PracticeText}>={
 healthy:{
  title:practiceText("Healthy window","健康視窗"),
  description:practiceText("Four sites stay near the synthetic 1.00 baseline; all six prediction stages have actuals. Practice explaining what this window can and cannot establish.","四個測試站維持在合成基準 1.00 附近，六個預測階段都有實際值。練習說明此視窗能支持哪些結論，以及有哪些限制。"),
  questions:[practiceText("What supports calling this synthetic window healthy, and what remains unverified?","哪些證據支持此合成視窗健康？還有哪些資訊尚未驗證？"),practiceText("Does 100% feature coverage prove prediction accuracy or whole-wafer health?","特徵涵蓋率 100% 能證明預測準確或整片晶圓健康嗎？")],
  answer:practiceText("All four synthetic site sequences stay near 1.00, and all six stages have paired predictions and actuals. This illustrates a stable window only. Full feature coverage does not prove accuracy, calibrated units or whole-wafer health. Check later windows and independent validation before generalizing.","四組合成測試站序列維持在 1.00 附近，六個階段皆有預測值與實際值配對。這只示範穩定視窗；完整特徵涵蓋率不能證明準確度、單位已校正或整片晶圓健康。推廣結論前，應檢查後續視窗與獨立驗證。"),
 },
 site:{
  title:practiceText("Site imbalance","測試站不平衡"),
  description:practiceText("Site 2 stays about 0.18 above sites 1, 3 and 4 throughout the same 32-sample window. Compare a persistent site offset with a time-dependent drift.","同一個 32 筆樣本視窗內，測試站 2 持續比測試站 1、3、4 高約 0.18。比較持續的站間偏差與隨時間變化的漂移。"),
  questions:[practiceText("Compare site 2 with sites 1, 3 and 4. Is this a fixed offset or a rising trend?","比較測試站 2 與測試站 1、3、4：這是固定偏差還是上升趨勢？"),practiceText("Which contact, calibration and site-identity checks could distinguish possible causes?","哪些接觸、校正與測試站識別檢查可協助區分可能原因？")],
  answer:practiceText("Site 2 is offset by about +0.18 throughout the synthetic window; the other three sites stay near 1.00. The site-2 series is stable, not progressively rising. Compare the same test and sample counts across sites, then inspect contact, calibration and site mapping. This pattern alone cannot identify a physical cause.","在合成視窗內，測試站 2 持續偏高約 +0.18，其餘三站維持在 1.00 附近。測試站 2 的序列穩定，並非逐步上升。應比較各站相同測試與樣本數，再檢查接觸、校正與站別對應；此模式本身無法確定物理原因。"),
 },
 drift:{
  title:practiceText("Mean drift","均值漂移"),
  description:practiceText("Site 2 rises from about 1.00 to 1.25 after sample 8 while the other sites stay stable. Use the sequence to locate the change.","第 8 筆樣本後，測試站 2 從約 1.00 上升至 1.25，其餘測試站保持穩定。利用序列找出變化位置。"),
  questions:[practiceText("Where does site 2 begin to drift, and how does it compare with the other sites?","測試站 2 從哪裡開始漂移？與其他測試站相比有何差異？"),practiceText("What additional evidence would separate contact drift from an environmental change?","還需要哪些證據，才能區分接觸漂移與環境變化？")],
  answer:practiceText("The synthetic site-2 sequence begins rising after sample 8 and ends near 1.25; sites 1, 3 and 4 remain near 1.00. The window mean exceeds the illustrative 1.08 threshold. Check subsequent windows, related tests and contact/environment records. Sequence positions represent sample order, not elapsed time; a trend does not prove a cause.","合成測試站 2 序列在第 8 筆後開始上升，末端接近 1.25；測試站 1、3、4 保持在 1.00 附近。視窗均值超過示範門檻 1.08。應檢查後續視窗、相關測試與接觸／環境記錄。序列位置代表樣本順序，並非經過時間；趨勢不能證明原因。"),
 },
 missing:{
  title:practiceText("Missing / late prediction data","預測資料缺漏／延遲"),
  description:practiceText("Stage 3 has only 24 of 32 required inputs, so its prediction is unavailable. Stage 6 has a prediction but its actual is late. Receive the late actual to practice a scoped join.","第 3 階段只有 32 個必要輸入中的 24 個，因此無法提供預測。第 6 階段已有預測，但實際值延遲。接收延遲實際值，練習依識別範圍配對。"),
  questions:[practiceText("Why is stage 3 unavailable while stage 6 is waiting for an actual?","為何第 3 階段無法預測，而第 6 階段是在等待實際值？"),practiceText("Which request, device and site identifiers must match before joining a late actual?","配對延遲實際值前，必須核對哪些請求、元件與測試站識別資訊？")],
  answer:practiceText("Stage 3 has 75% input coverage and no prediction or actual; never fill these gaps with zero or later inputs. Stage 6 has full feature coverage and a queued prediction; inspect its actual column for the late-data state. Join only matching run, tester, request, device, site and stage identities. Receiving a late actual does not repair stage 3 or prove on-time delivery.","第 3 階段輸入涵蓋率為 75%，沒有預測值或實際值；不可用零值或後續輸入補造結果。第 6 階段特徵完整且預測已排入佇列；請查看實際值欄位確認延遲資料狀態。僅可配對相同執行、測試機、請求、元件、測試站與階段的資料。接收延遲實際值不會修復第 3 階段，也不能證明準時送達。"),
 },
};
function createPracticeBatch(kind:PracticeScenario,sequence:number,locale:"en"|"zh-TW",timestamp=new Date().toISOString()):Batch{
 const batch=createFixture(kind==="missing"?"missing":kind==="healthy"?"normal":"anomaly",sequence,timestamp);
 const suffix=`${kind}-${sequence}`;const eventId=`sandbox-practice-event-${suffix}`;const evidenceId=`sandbox-practice-evidence-${suffix}`;const incidentId=`sandbox-practice-incident-${suffix}`;
 const sites=Object.fromEntries([1,2,3,4].map(site=>[String(site),Array.from({length:32},(_,i)=>Number((1+((i+site)%5-2)*.004+(site===2?(kind==="site"?.18:kind==="drift"?Math.max(0,i-7)*.0105:0):0)).toFixed(4)))]));
 batch.batch_id=`sandbox-practice-batch-${suffix}`;
 for(const record of batch.records){
  if(record.type==="command_ack")continue;
  record.run_id="SANDBOX-PRACTICE";record.tester_id="synthetic-tester";record.lot_id="SYNTHETIC-LOT";record.wafer_id=`SYNTHETIC-${kind.toUpperCase()}`;
  if(record.type==="event"){record.event_id=eventId;record.evidence_ids=[evidenceId];record.incident_id=record.incident_id?incidentId:null;record.message=`${locale==="en"?"Synthetic practice":"合成練習"}: ${practiceCases[kind].description[locale]}`;if(kind==="site")record.kind="external_evidence";}
  if(record.type==="incident"){record.incident_id=incidentId;record.event_ids=[eventId];record.evidence_ids=[evidenceId];record.title=practiceCases[kind].title[locale];}
  if(record.type==="evidence"){
   record.event_id=eventId;record.evidence_id=evidenceId;record.test_name="Synthetic.practice#CP";record.baseline=1;
   if(kind!=="missing"){record.site_series=sites;record.series=sites["2"].map((value,i)=>({index:i+1,value}));record.observed=Number((sites["2"].reduce((sum,value)=>sum+value,0)/32).toFixed(4));}
  }
  if(record.type==="prediction"){
   const i=record.stage-1;record.event_id=eventId;record.prediction_id=`sandbox-practice-prediction-${suffix}-${record.stage}`;record.request_id=`practice-request-${suffix}-${record.stage}-site2`;record.original_request_id=`practice-request-${suffix}-${record.stage}`;record.source_event_id=eventId;record.source_mode="simulation";record.device_id="SYNTHETIC-D032";record.unit="synthetic °C";
   record.predicted=kind==="missing"&&record.stage===3?null:[25.12,25.31,25.49,25.66,25.87,26.05][i];
   record.actual=kind==="missing"&&(record.stage===3||record.stage===6)?null:[25.14,25.29,25.51,25.64,25.9,26.02][i];
   record.coverage=kind==="missing"&&record.stage===3?.75:1;record.response_status=record.predicted===null?"insufficient_data":"response_queued";record.latency_ms=record.predicted===null?null:1.2;
  }
 }
 return batchSchema.parse(batch);
}
function latePracticeActual(view:EventView):Batch|null{
 const prediction=view.predictions.find(p=>p.stage===6&&p.predicted!==null&&p.actual===null);
 if(!prediction)return null;
 return {schema_version:"0.1-draft",batch_id:`${view.event.event_id}-late-actual`,sent_at:new Date().toISOString(),records:[{...prediction,actual:26.02}]};
}
function timeOf(stamp:string){return new Date(stamp).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Taipei"});}
function Trend({evidence:e}: {evidence:EvidenceRecord}){
 const {t} = useLocale();

 const sites=Object.entries(e.site_series??{}).filter(([,values])=>values.length);
 const lines=e.metric!=='yield'&&sites.length?sites.map(([site,values])=>({label:t('Site {0}',site),points:values.map((value,index)=>({index:index+1,value}))})):[{label:'Observed',points:e.series}];
 const points=lines.flatMap(line=>line.points);
 if(!points.length)return <div className="no-chart"><CircleDashed size={30}/><strong>{t("No sequence supplied")}</strong><span>{t("Missing values are unavailable, not zero or evidence of normal operation.")}</span></div>;
 const vals=[...points.map(p=>p.value),...(e.baseline===null?[]:[e.baseline])];
 const low=Math.min(...vals),high=Math.max(...vals),pad=Math.max((high-low)*.17,.01),min=low-pad,max=high+pad;
 const count=Math.max(...lines.map(line=>line.points.length));
 const y=(v:number)=>190-(v-min)/(max-min)*155;const x=(i:number)=>53+i/Math.max(count-1,1)*567;
 const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)'];
 const valueLabel=(value:number)=>e.metric==='yield'?`${(value*100).toFixed(1)}%`:value.toFixed(2);
 return <div className="trend"><div className="chart-title"><span>{t("Measurement sequence")}<small>{e.metric==='yield' ? t("Yield %") : e.unit}</small></span><div className="legend">{lines.map((line,i)=><span key={line.label}><i style={{borderColor:colors[i%colors.length]}}/>{t(line.label)}</span>)}</div></div><svg viewBox="0 0 650 235" role="img" aria-label={t("Source sequence; x-axis is completed-device order, not time")}>
 {[0,1,2,3].map(i=>{const v=min+(max-min)*i/3;return <g key={i}><path d={`M53 ${y(v)}H620`} stroke="var(--border)"/><text x="40" y={y(v)+4} textAnchor="end">{valueLabel(v)}</text></g>})}
 {e.baseline!==null && <path d={`M53 ${y(e.baseline)}H620`} stroke="var(--muted-foreground)" strokeDasharray="5 5"/>}
 {lines.map((line,i)=><path key={line.label} d={line.points.map((p,j)=>`${j?'L':'M'} ${x(j)} ${y(p.value)}`).join(' ')} fill="none" stroke={colors[i%colors.length]} strokeWidth="2.6" strokeLinejoin="round"/>)}
 {[0,Math.floor((count-1)/2),count-1].map((i,k)=><text key={k} x={x(i)} y="214" textAnchor="middle">{lines[0].points[i]?.index ?? i+1}</text>)}<text x="620" y="232" textAnchor="end">{sites.length&&e.metric!=='yield' ? t("Completed-device order within each site") : t("Completed-device order")}</text>
 </svg></div>;
}
export default function Home(){
 const {t, locale} = useLocale();
 const practiceLabel=(text:PracticeText)=>text[locale];
 const [practiceScenario,setPracticeScenario]=useState<PracticeScenario>("healthy");
 const [practiceEvents,setPracticeEvents]=useState<Record<string,PracticeScenario>>({});
 const [fixtureEvents,setFixtureEvents]=useState<Record<string,FixtureScenario>>({});

 const [workspace,setWorkspace]=useState<Workspace>(emptyWorkspace);const stateRef=useRef(workspace);
 const [selected,setSelected]=useState<string|null>(null);const [scenario,setScenario]=useState<Scenario>("anomaly");const seq=useRef(0);
 const [notice,setNotice]=useState("");const [inputError,setInputError]=useState("");const [raw,setRaw]=useState("");
 const [aiMode,setAiMode]=useState<"demo"|"openai">("demo");const [config,setConfig]=useState<{openai_configured:boolean;model:string}|null>(null);
 const [configError,setConfigError]=useState(false);const [chats,setChats]=useState<Record<string,Reply[]>>({});const [question,setQuestion]=useState("");
 const [busy,setBusy]=useState(false);const busyRef=useRef(false);const pending=useRef<AbortController|null>(null);const [aiError,setAiError]=useState("");const [copied,setCopied]=useState(false);const copySeq=useRef(0);
 const current=workspace.items.find(i=>i.event.event_id===selected)??workspace.items[0];const currentId=current?.event.event_id;
 const currentPractice=currentId?practiceEvents[currentId]:undefined;
 // Only locally generated teaching copy follows language changes. Imported source stays verbatim.
 const currentFixture=currentId?fixtureEvents[currentId]:undefined;
 const eventTitle=currentPractice?practiceLabel(practiceCases[currentPractice].title):currentFixture&&current?.incident?practiceLabel(fixtureTitle):current?.incident?.title;
 const eventMessage=currentPractice?`${locale==="en"?"Synthetic practice":"合成練習"}: ${practiceLabel(practiceCases[currentPractice].description)}`:currentFixture?practiceLabel(fixtureMessages[currentFixture]):current?.event.message;
 const threadKey=currentId?`${currentId}:${aiMode}`:"";const replies=chats[threadKey]??[];const chatEnd=useRef<HTMLDivElement>(null);
 const cancelInvestigation=useCallback(()=>{pending.current?.abort();pending.current=null;busyRef.current=false;setBusy(false);},[]);
 const accept=useCallback((input:unknown)=>{
  try{const previous=stateRef.current;const batch=adaptIncoming(input,previous);const next=receiveBatch(previous,batch);cancelInvestigation();setQuestion("");setAiError("");stateRef.current=next;setWorkspace(next);copySeq.current++;setCopied(false);
   const event=batch.records.find(r=>r.type==="event");if(event)setSelected(event.event_id);
   const duplicates=next.duplicateCount-previous.duplicateCount;
   setNotice(duplicates?`Ignored ${duplicates} duplicate events; no duplicate incidents created.`:`Batch received; ${next.items.length} unique events in this workspace.`);setInputError("");return next;
  }catch(error){setInputError(error instanceof Error&&!("issues" in error)?error.message:"Invalid event batch. Check schema_version, records, timestamps and required fields.");throw error;}
 },[cancelInvestigation]);
 const simulate=useCallback((kind:Scenario)=>{
   const last=stateRef.current.batches.at(-1);if(kind==="duplicate"&&!last){setInputError("Receive a batch before testing duplicate delivery.");return;}
   const batch=kind==="duplicate"?last!:createSandboxFixture(kind,++seq.current,locale);accept(batch);
   if(kind!=="duplicate"){const event=batch.records.find(record=>record.type==="event")!;setFixtureEvents(previous=>({...previous,[event.event_id]:kind}));}
 },[accept,locale]);
 function loadPractice(){
  const batch=createPracticeBatch(practiceScenario,++seq.current,locale);
  const event=batch.records.find(record=>record.type==="event")!;
  accept(batch);setPracticeEvents(previous=>({...previous,[event.event_id]:practiceScenario}));setAiMode("demo");
 }
 useEffect(()=>{const controller=new AbortController();fetch("/api/config",{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>setConfig(z.object({openai_configured:z.boolean(),model:z.string()}).parse(data))).catch(e=>{if(e.name!=="AbortError")setConfigError(true);});return()=>controller.abort();},[]);
 useEffect(()=>{
  const listener=(event:Event)=>{try{accept((event as CustomEvent).detail);}catch{/* visible validation error */}};
  window.addEventListener("rtdi:batch",listener);return()=>window.removeEventListener("rtdi:batch",listener);
 },[accept]);
 useEffect(()=>{chatEnd.current?.scrollIntoView({block:"nearest",behavior:"smooth"});},[replies.length,busy]);
 useEffect(()=>()=>{pending.current?.abort();pending.current=null;copySeq.current++;},[]);
 // Optional WebMCP: same validated input and state as the visible JSON receiver.
 useEffect(()=>{
  type ModelContext={registerTool:(tool:{name:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>Promise<unknown>},options:{signal:AbortSignal})=>void|Promise<void>};
  const context=(document as Document&{modelContext?:ModelContext}).modelContext;if(!context?.registerTool)return;
  const lifetime=new AbortController();
  void Promise.resolve(context.registerTool({name:"receive_rtdi_demo_batch",description:"Receive a synthetic RTDI batch in the visible prototype. Never sends machine commands or calls OpenAI.",inputSchema:{type:"object",properties:{scenario:{type:"string",enum:["anomaly","normal","missing","duplicate"]}},required:["scenario"],additionalProperties:false},annotations:{readOnlyHint:false},async execute(input){
    const value=input as {scenario?:Scenario};if(!value||Object.keys(value).length!==1||!Object.keys(scenarioLabels).includes(value.scenario??""))throw Error("Invalid scenario");
    if(value.scenario==="duplicate"&&!stateRef.current.batches.length)throw Error("No previous batch");simulate(value.scenario!);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return {event_count:stateRef.current.items.length,duplicate_count:stateRef.current.duplicateCount};
  }},{signal:lifetime.signal})).catch(()=>{});return()=>lifetime.abort();
 },[simulate]);
 async function ask(text:string){
   if(!current||!text.trim()||busyRef.current||(aiMode==='openai'&&!config?.openai_configured))return;const sent=text.trim();const context=current;const key=threadKey;const history=replies.slice(-10).map(({role,content})=>({role,content}));
   if(currentPractice&&aiMode==="demo"){
    const answer=`${practiceLabel(practiceText("Fixed practice explanation · no model API call","固定練習說明・未呼叫模型 API"))}\n\n${practiceLabel(practiceCases[currentPractice].answer)} [${current.evidence[0]?.evidence_id??current.event.event_id}]\n\n${practiceLabel(practiceText("All values are synthetic. Tester receipt is unconfirmed; no command was sent.","所有數值均為合成資料。測試機接收狀態尚未確認；未傳送任何指令。"))}`;
    setChats(previous=>({...previous,[key]:[...(previous[key]??[]),{role:"user",content:sent},{role:"assistant",content:answer,mode:"demo",model:null}]}));setQuestion("");setAiError("");return;
   }
   const controller=new AbortController();pending.current=controller;busyRef.current=true;setBusy(true);setAiError("");setQuestion("");
   try{const response=await fetch("/api/assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:aiMode,question:sent,context,history,language:locale}),signal:controller.signal});
    const payload=await response.json();if(pending.current!==controller||controller.signal.aborted)return;if(!response.ok){const failure=z.object({error:z.string()}).safeParse(payload);throw Error(failure.success?failure.data.error:"No answer returned. Retry the request.");}
    const data=z.object({answer:z.string(),mode:z.enum(["demo","openai"]),model:z.string().nullable()}).parse(payload);
    setChats(prev=>({...prev,[key]:[...(prev[key]??[]),{role:"user",content:sent},{role:"assistant",content:data.answer,mode:data.mode,model:data.model}]}));
   }catch(error){if(pending.current===controller&&!controller.signal.aborted&&error instanceof Error&&error.name!=="AbortError"){setAiError(error.message);setQuestion(sent);}}
   finally{if(pending.current===controller){pending.current=null;busyRef.current=false;setBusy(false);}}
 }
 function reset(){copySeq.current++;setCopied(false);cancelInvestigation();const fresh=emptyWorkspace();stateRef.current=fresh;setWorkspace(fresh);setSelected(null);setChats({});setAiError("");setInputError("");setQuestion("");setRaw("");setPracticeEvents({});setFixtureEvents({});setPracticeScenario("healthy");setScenario("anomaly");setAiMode("demo");setNotice("Local workspace cleared. Tester data is unchanged.");}
 const aiUnavailable=aiMode==='openai'&&!config?.openai_configured;
 const e=current?.evidence[0];const anomalies=new Set(workspace.items.map(i=>i.event.incident_id).filter(Boolean)).size;
 return <div className="shell"><AppHeader active="sandbox"/>
 <main id="main-content" className="workspace"><div className="heading"><div><div className="eyebrow">{t("GRP6 / EVENT SANDBOX")}</div><h1>{t("Event sandbox")}</h1><p className="sub">{t("Validate event batches, inspect evidence and test investigation requests.")}</p></div><div className="receive-controls"><NativeSelect aria-label={t("Fixture scenario")} value={scenario} onChange={ev=>setScenario(ev.target.value as Scenario)}>{Object.entries(scenarioDisplayLabels).map(([k,v])=><NativeSelectOption value={k} key={k}>{t(v)}</NativeSelectOption>)}</NativeSelect><Button className="primary-action" onClick={()=>simulate(scenario)}><Radio size={17}/> {t("Receive fixture")}<ArrowUpRight size={16}/></Button></div></div>
 <div className="simulation-banner"><FlaskConical size={16}/><span>{t("Built-in scenarios use synthetic data. This sandbox has no live tester connection; assistant responses do not prove tester receipt.")}</span><span className="banner-end">{t("SIMULATION MODE")}</span></div>
 <section className="panel" aria-labelledby="practice-title" style={{padding:20,marginBottom:20}}>
  <div className="section-title"><h2 id="practice-title">{practiceLabel(practiceText("Practice with synthetic scenarios","合成情境練習"))}</h2></div>
  <p className="sub">{practiceLabel(practiceText("Choose an example, load it, then review a question draft. Loading adds a local event and selects rule-based mode; it makes no model request.","選擇並載入範例，再檢視問題草稿。載入會新增本機事件並選用規則模式，不會發出模型請求。"))}</p>
  <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:12,marginBlock:12}}>
   <label htmlFor="practice-scenario">{practiceLabel(practiceText("Practice scenario","練習情境"))}</label>
   <div style={{minWidth:0,maxWidth:"100%"}}><NativeSelect id="practice-scenario" value={practiceScenario} onChange={event=>setPracticeScenario(event.target.value as PracticeScenario)} style={{maxWidth:"100%"}}>{(Object.keys(practiceCases) as PracticeScenario[]).map(kind=><NativeSelectOption key={kind} value={kind}>{practiceLabel(practiceCases[kind].title)}</NativeSelectOption>)}</NativeSelect></div>
   <Button type="button" variant="outline" onClick={loadPractice}><FlaskConical size={16}/>{practiceLabel(practiceText("Load practice example","載入練習範例"))}</Button>
  </div>
  <p className="sub">{practiceLabel(practiceCases[practiceScenario].description)}</p>
 </section>
 <div className="stats"><div><span>{t("Input source")}</span><strong>{t("Local")}<small>{t("events")}</small></strong><p>{t("Browser workspace")}</p></div><div><span>{t("Unique events")}</span><strong>{String(workspace.items.length).padStart(2,"0")} <small>{t("events")}</small></strong><p>{workspace.duplicateCount ? t("{0} duplicates ignored", workspace.duplicateCount) : t("Current browser session")}</p></div><div><span>{t("Tagged incidents")}</span><strong className="orange">{String(anomalies).padStart(2,"0")}</strong><p>{anomalies ? t("Counted from source incident IDs") : t("No tagged incidents")}</p></div><div><span>{t("Investigation service")}</span><strong>OpenAI</strong><p>{configError ? t("Configuration check failed") : config?.openai_configured ? t("Configured · model call unverified") : config ? t("Unconfigured · rule-based mode available") : t("Checking configuration…")}</p></div></div>
 <div className="status-row"><span role="status" aria-live="polite">{t(notice) || t("Select a fixture scenario to receive the first event.")}</span><Button variant="ghost" size="sm" onClick={reset} disabled={!workspace.items.length&&!inputError&&!raw&&!question&&practiceScenario==="healthy"&&scenario==="anomaly"}><RotateCcw size={13}/> {t("Reset workspace")}</Button></div>
 {inputError && <Alert variant="destructive" className="inline-error"><TriangleAlert/><AlertDescription>{t(inputError)}</AlertDescription></Alert>}
 <div className="work-grid"><section className="panel evidence-panel"><div className="panel-header"><h2><Activity size={18}/> {t("Events & evidence")}</h2><span className="mini-label">{t("EVENT WORKSPACE")}</span></div>
 <Tabs defaultValue="evidence" className="event-tabs"><TabsList variant="line" aria-label={t("Event views")}><TabsTrigger value="evidence">{t("Event analysis")}</TabsTrigger><TabsTrigger value="predictions">{t("Temperature predictions")}</TabsTrigger><TabsTrigger value="message">{t("Message JSON")}</TabsTrigger></TabsList>
 <TabsContent value="evidence">{!current ? <div className="empty"><div className="empty-icon"><Radio size={30}/></div><h3>{t("No events loaded")}</h3><p>{t("Receive a synthetic fixture or paste a supported JSON batch.")}</p><Button variant="outline" onClick={()=>simulate("anomaly")}>{t("Receive fixture")}<ArrowUpRight size={16}/></Button></div> : <div className="event-body">
 <div className={`event-badge ${current.event.kind==='normal'?'normal-badge':current.event.kind==='missing_data'?'missing-badge':''}`}>{current.event.kind==='normal'?<Check size={14}/>:<TriangleAlert size={14}/>} {t(kindLabels[current.event.kind])}<span>· {t(modeLabels[current.event.mode])}</span></div>
 <h2>{eventTitle ?? t(kindLabels[current.event.kind])}</h2><p className="event-message">{eventMessage}</p>
 <div className="event-meta"><span>{current.event.wafer_id}</span><span>{t("Site")}{current.event.site ?? t("All")}</span><span>{timeOf(current.event.occurred_at)} {t("UTC+8")}</span></div>
 {e?<><div className="evidence-metrics"><div><span>{e.metric==='yield' ? t("Yield") : e.metric==='coverage' ? t("Feature coverage") : e.metric==='measurement' ? t("Observed") : t("Window mean")}</span><strong>{e.observed===null ? '—' : (e.metric==='coverage'||e.metric==='yield') ? `${(e.observed*100).toFixed(1)}%` : e.observed.toFixed(4)}<small>{(e.metric==='coverage'||e.metric==='yield') ? '' : e.unit}</small></strong></div><div><span>{t("Reference baseline")}</span><strong>{e.baseline===null ? '—' : e.metric==='yield' ? `${(e.baseline*100).toFixed(1)}%` : e.baseline}</strong></div><div><span>{t("Samples")}</span><strong>{e.sample_count}<small>{t("samples")}</small></strong></div></div><Trend evidence={e}/><div className="evidence-foot"><span>{e.test_name}</span><span>{t("Evidence ·")}{e.evidence_id}</span><span>{t("Source threshold:")}{e.threshold ?? t("Not provided")} {t("· scale unverified")}</span>{e.response_status&&<span>{t("Response:")}{t(responseLabels[e.response_status])} {t("· Receipt:")}{e.tester_receipt_id ?? t("Not provided")}</span>}</div>{e.missing_fields.length>0&&<div className="missing-fields"><Info size={15}/><span>{t("Missing:")}{e.missing_fields.join(', ')}</span></div>}</>:<div className="no-chart"><Info/><strong>{t("No matching evidence")}</strong><span>{t("A message alone cannot establish root cause. Matching evidence is required.")}</span></div>}
 <div className="delivery"><div><Bell size={15}/><strong>{t("Tester delivery")}</strong><span>{t("No command created")}</span></div><div className="delivery-steps" style={{flexWrap:"wrap"}}><span>{t("Draft")}</span><ChevronRight/><span>{t("Backend queue")}</span><ChevronRight/><span>{t("Edge receipt")}</span><ChevronRight/><span>{t("Tester queue")}</span><ChevronRight/><span>{t("Tester receipt")}</span></div><p>{t("This sandbox does not send tester commands. Assistant answers do not change delivery status.")}</p></div>
 </div>}</TabsContent>
 <TabsContent value="predictions"><div className="prediction-body"><div className="section-title"><h3>{t("Six-stage temperature predictions")}</h3><span>{t("Selected event only")}</span></div><p className="sub">{t("Fixture values do not establish model accuracy or physical units. A queued response is not tester confirmation.")}</p>{current?.predictions.length ? <div className="table-scroll"><table><thead><tr><th>{t("Stage")}</th><th>{t("Predicted / actual")}</th><th>{t("Coverage")}</th><th>{t("Response status")}</th></tr></thead><tbody>{current.predictions.map(p=><tr key={p.prediction_id}><td><span className="stage-number">0{p.stage}</span><details><summary>{t("Prediction provenance")}</summary><small>{t("Per-site request:")}{p.request_id ?? t("Not provided")}</small><small>{t("Original request:")}{p.original_request_id ?? t("Not provided")}</small><small>{t("Source event:")}{p.source_event_id ?? t("Not provided")}</small></details></td><td><strong>{p.predicted?.toFixed(2) ?? '—'}</strong><span className="actual"> / {p.actual?.toFixed(2) ?? '—'}</span><small>{currentFixture?practiceLabel(fixtureUnit):p.unit}</small></td><td>{p.coverage===null ? t("Unknown") : `${Math.round(p.coverage*100)}%`}</td><td><span className={`prediction-status ${p.response_status==='insufficient_data'?'orange':''}`}>{t(responseLabels[p.response_status])}</span>{p.tester_receipt_id&&<small>{p.tester_receipt_id}</small>}</td></tr>)}</tbody></table></div> : <div className="no-chart"><Cpu/><strong>{t("No predictions supplied")}</strong><span>{t("Receive an event batch to inspect its associated predictions.")}</span></div>}</div></TabsContent>
 <TabsContent value="message"><div className="json-body"><div className="section-title"><h3>{t("Receive event batch")}</h3><span>{t("Draft interface v0.1")}</span></div><p className="sub">{t("Paste a supported event batch. Validation and deduplication run before updating this browser workspace.")}</p><label htmlFor="batch-json" className="field-label">{t("Message JSON")}</label><Textarea id="batch-json" className="json-editor" value={raw} onChange={ev=>setRaw(ev.target.value)} placeholder={'{"schema_version":"0.1-draft","batch_id":"...","sent_at":"...","records":[...]}'} spellCheck={false}/><div className="json-actions"><Button variant="outline" onClick={()=>setRaw(JSON.stringify(createSandboxFixture("anomaly",++seq.current,locale),null,2))}><FileJson2 size={15}/> {t("Load fixture")}</Button><Button onClick={()=>{try{accept(JSON.parse(raw));}catch(error){if(error instanceof SyntaxError)setInputError("Invalid JSON syntax. Check braces, quotes and commas.");}}} disabled={!raw.trim()}><Radio size={15}/> {t("Receive JSON")}</Button></div>{current && <details className="raw-details"><summary>{t("View source event fields")}</summary><pre>{JSON.stringify(current,null,2)}</pre><Button variant="ghost" size="sm" onClick={async()=>{const request=++copySeq.current;setCopied(false);try{await navigator.clipboard.writeText(JSON.stringify(current,null,2));if(request===copySeq.current)setCopied(true);}catch{if(request===copySeq.current)setNotice("Clipboard unavailable. Select the source text to copy manually.");}}}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied ? t("Copied") : t("Copy source")}</Button></details>}</div></TabsContent></Tabs>
 {workspace.items.length>0 && <div className="event-inbox"><div className="section-title"><h3>{t("Received events")}</h3><span>{workspace.items.length} {t("unique events")}</span></div><div className="inbox-list">{workspace.items.map(item=><button key={item.event.event_id} className={`inbox-item ${item.event.event_id===currentId?'selected':''}`} onClick={()=>{cancelInvestigation();setSelected(item.event.event_id);setAiError("");setQuestion("");copySeq.current++;setCopied(false);}} aria-pressed={item.event.event_id===currentId}><span className={`inbox-symbol ${item.event.kind==='normal'?'normal':''}`}>{item.event.kind==='normal'?<Check size={15}/>:<Activity size={15}/>}</span><span><strong>{t(kindLabels[item.event.kind])}</strong><small>{item.event.wafer_id} {t("· Site")}{item.event.site}</small></span><time>{timeOf(item.event.occurred_at)}</time><ChevronRight size={14}/></button>)}</div></div>}
 </section>
 <aside className="panel ai-panel"><div className="panel-header"><h2><ClipboardList size={18}/> {t("Investigation log")}</h2><span className="assistant-label">{t("EVENT CONTEXT")}</span></div><div className="ai-toolbar"><NativeSelect value={aiMode} aria-label={t("Response mode")} onChange={ev=>{cancelInvestigation();setAiMode(ev.target.value as "demo"|"openai");setQuestion("");setAiError("");}} disabled={busy}><NativeSelectOption value="demo">{t("Rule-based analysis")}</NativeSelectOption><NativeSelectOption value="openai">{t("OpenAI API")}</NativeSelectOption></NativeSelect><span>{aiMode==='demo' ? t("No model API call") : config?.openai_configured ? t("Configured") : t("Unconfigured")}</span></div>
 {currentPractice&&current&&<div style={{padding:20,borderBottom:"1px solid var(--border)"}} aria-label={practiceLabel(practiceText("Selected practice guidance","已選練習指引"))}>
  <strong>{practiceLabel(practiceText("Loaded practice: ","已載入練習："))}{practiceLabel(practiceCases[currentPractice].title)}</strong>
  <p className="sub">{practiceLabel(practiceCases[currentPractice].description)}</p>
  <div className="suggestions"><p>{t("Draft only · Select a question, review it, then submit.")}</p>{practiceCases[currentPractice].questions.map((prompt,index)=><Button key={index} type="button" variant="outline" disabled={busy||aiUnavailable} onClick={()=>{setQuestion(practiceLabel(prompt));setAiError("");}} style={{whiteSpace:"normal",height:"auto",textAlign:"start"}}>{practiceLabel(prompt)}<ClipboardList size={14}/></Button>)}</div>
  {currentPractice==="missing"&&<div style={{marginTop:12}}><Button type="button" variant="outline" disabled={!latePracticeActual(current)} onClick={()=>{const batch=latePracticeActual(current);if(batch)accept(batch);}}>{practiceLabel(practiceText("Receive late stage 6 actual","接收第 6 階段延遲實際值"))}</Button><p className="sub" role="status">{practiceLabel(latePracticeActual(current)?practiceText("Stage 6 actual: waiting. Stage 3 remains unavailable.","第 6 階段實際值：等待中。第 3 階段仍無法提供預測。"):practiceText("Synthetic stage 6 actual joined: 26.02. Stage 3 remains unavailable; tester receipt is unconfirmed.","合成第 6 階段實際值已配對：26.02。第 3 階段仍無法提供預測；測試機接收尚未確認。"))}</p></div>}
 </div>}
 <div className="sandbox-service" role="status">{aiUnavailable ? t("OpenAI is unavailable. Use rule-based analysis or reload after the service is configured.") : aiMode==='demo' ? t("Rule-based fixture analysis. No model API call.") : t("Submitting a question sends a request to OpenAI.")}</div><div className="chat-scroll" aria-live="polite">{!replies.length ? <div className="assistant-intro"><h3>{current ? t("Selected event analysis") : t("No event selected")}</h3><p>{current ? t("Review observed values, possible causes and checks using the selected event evidence.") : t("Receive an event to enable analysis. Missing evidence limits the conclusions available.")}</p>{current&&<div className="context-card"><span>{t("Selected context")}</span><strong>{t(kindLabels[current.event.kind])} {t("· Site")}{current.event.site}</strong><small>{current.event.event_id}</small></div>}<div className="suggestions"><p>{t("Draft only · Select a question, review it, then submit.")}</p>{prompts.map(p=><Button key={p} type="button" variant="outline" disabled={!current||busy||aiUnavailable} onClick={()=>{setQuestion(t(p));setAiError("");}}>{t(p)}<ClipboardList size={14}/></Button>)}</div><div className="ai-note"><Info size={14}/><span>{aiMode==='demo' ? t("Rule-based responses are predefined, not generated by an LLM.") : t("Submitting sends the selected event and this mode’s conversation to OpenAI.")}</span></div></div> : <div className="messages">{replies.map((reply,i)=><div key={i} className={`chat-message ${reply.role}`}><div className="message-author">{reply.role==='assistant'?<ClipboardList size={13}/>:null}{reply.role==='user' ? t("You") : reply.mode==='demo' ? t("Rule-based analysis") : t("OpenAI · {0}", reply.model)}</div><div className="message-text">{reply.content}</div></div>)}</div>}{busy && <div className="thinking"><LoaderCircle size={15} className="spin"/> {t("Analyzing selected event evidence…")}</div>}<div ref={chatEnd}/></div>
 {aiError && <Alert variant="destructive" className="ai-error"><TriangleAlert/><AlertDescription>{t(aiError)}</AlertDescription></Alert>}
 <form className="composer" onSubmit={ev=>{ev.preventDefault();void ask(question);}}><Textarea aria-label={t("Investigation question")} placeholder={current ? t("Ask about this event, for example: What evidence is missing?") : t("Receive an event to enable questions…")} value={question} onChange={ev=>setQuestion(ev.target.value)} disabled={!current||busy||aiUnavailable} maxLength={2000} onKeyDown={ev=>{if(ev.key==='Enter'&&!ev.shiftKey&&!ev.nativeEvent.isComposing){ev.preventDefault();void ask(question);}}}/><div className="composer-footer"><span>{aiMode==='demo' ? t("Rule-based mode · no OpenAI call") : t("OpenAI Responses API")}</span><Button type="submit" size="icon" disabled={!current||busy||aiUnavailable||!question.trim()} aria-label={t("Submit question")}>{busy ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>}</Button></div></form>
 </aside></div><footer><span><Bell size={13}/> {t("Tester command and receipt transport is not connected")}</span><span>{t("RTDI Insight · grp6 / Local sandbox")}</span></footer></main></div>;
}
