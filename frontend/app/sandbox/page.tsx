"use client";
import { z } from "zod";
import { useCallback,useEffect,useRef,useState } from "react";
import { Activity, ArrowUpRight, Bell, Check, ChevronRight, CircleDashed, Copy, Cpu, FileJson2, FlaskConical, Info, LoaderCircle, Radio, RotateCcw, Send, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect,NativeSelectOption } from "@/components/ui/native-select";
import { Tabs,TabsList,TabsTrigger,TabsContent } from "@/components/ui/tabs";
import { Alert,AlertDescription } from "@/components/ui/alert";
import { batchSchema,emptyWorkspace,receiveBatch,type EvidenceRecord,type EventView,type Workspace } from "@/lib/rtdi/contracts";
import { adaptIncoming } from "@/lib/rtdi/edge-adapter";
import { createFixture,scenarioLabels,type Scenario } from "@/lib/rtdi/fixtures";
import type { ChatMessage } from "@/lib/rtdi/assistant";

type Reply=ChatMessage&{mode?:"demo"|"openai";model?:string|null};
const kindLabels={normal:"正常觀測",mean_drift:"均值偏移",low_yield:"良率下降",missing_data:"資料不足",measurement:"測量紀錄",prediction:"預測紀錄",external_evidence:"外部異常證據",heartbeat:"Edge 心跳",run_summary:"Wafer 摘要"};
const modeLabels={simulation:"自造示範",replay:"重播資料",live:"外部 live 標記 · 尚待驗證"};
const responseLabels={unknown:"尚未確認",not_requested:"未請求",insufficient_data:"缺少資料",response_queued:"回覆已排隊",tester_confirmed:"含機台回執"};
const prompts=["這則異常代表什麼？","接下來應該檢查什麼？","機台收到訊息了嗎？"];
function timeOf(stamp:string){return new Date(stamp).toLocaleTimeString("zh-TW",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Taipei"});}
function Trend({evidence:e}: {evidence:EvidenceRecord}){
 if(!e.series.length)return <div className="no-chart"><CircleDashed size={30}/><strong>未提供趨勢序列</strong><span>不以缺值補零，也不將缺資料視為正常。</span></div>;
 const points=e.series;const vals=[...points.map(p=>p.value),...(e.baseline===null?[]:[e.baseline]),...(e.threshold===null?[]:[e.threshold])];
 const low=Math.min(...vals),high=Math.max(...vals),pad=Math.max((high-low)*.17,.01),min=low-pad,max=high+pad;
 const y=(v:number)=>190-(v-min)/(max-min)*155;const x=(i:number)=>53+i/Math.max(points.length-1,1)*567;
 const path=points.map((p,i)=>`${i?'L':'M'} ${x(i)} ${y(p.value)}`).join(" ");
 return <div className="trend"><div className="chart-title"><span>測試結果趨勢 <small>{e.unit}</small></span><div className="legend"><span><i className="blue-line"/>觀測值</span><span><i className="dash-line"/>基準</span><span><i className="amber-line"/>門檻</span></div></div><svg viewBox="0 0 650 235" role="img" aria-label={`${e.sample_count} 筆測試結果，均值 ${e.observed}，基準 ${e.baseline}，門檻 ${e.threshold}`}>
 <defs><linearGradient id={`fill-${e.evidence_id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5673e8" stopOpacity=".16"/><stop offset="100%" stopColor="#5673e8" stopOpacity=".01"/></linearGradient></defs>
 {[0,1,2,3].map(i=>{const v=min+(max-min)*i/3;return <g key={i}><path d={`M53 ${y(v)}H620`} stroke="#eef1f7"/><text x="40" y={y(v)+4} textAnchor="end">{v.toFixed(2)}</text></g>})}
 {e.baseline!==null&&<path d={`M53 ${y(e.baseline)}H620`} stroke="#96a3bd" strokeDasharray="5 5"/>}
 {e.threshold!==null&&<path d={`M53 ${y(e.threshold)}H620`} stroke="#d6a667" strokeDasharray="4 5"/>}
 <path d={`${path} L620 190 L53 190Z`} fill={`url(#fill-${e.evidence_id})`}/><path d={path} fill="none" stroke="#5673e8" strokeWidth="2.6" strokeLinejoin="round"/>
 {points.map((p,i)=><circle key={i} cx={x(i)} cy={y(p.value)} r="2.3" fill="#5673e8"><title>樣本 {p.index}: {p.value} {e.unit}</title></circle>)}
 {[0,Math.floor((points.length-1)/2),points.length-1].map((i,k)=><text key={k} x={x(i)} y="214" textAnchor="middle">{points[i].index}</text>)}<text x="620" y="232" textAnchor="end">樣本順序</text>
 </svg></div>;
}
export default function Home(){
 const [workspace,setWorkspace]=useState<Workspace>(emptyWorkspace);const stateRef=useRef(workspace);
 const [selected,setSelected]=useState<string|null>(null);const [scenario,setScenario]=useState<Scenario>("anomaly");const seq=useRef(0);
 const [notice,setNotice]=useState("");const [inputError,setInputError]=useState("");const [raw,setRaw]=useState("");
 const [aiMode,setAiMode]=useState<"demo"|"openai">("demo");const [config,setConfig]=useState<{openai_configured:boolean;model:string}|null>(null);
 const [configError,setConfigError]=useState(false);const [chats,setChats]=useState<Record<string,Reply[]>>({});const [question,setQuestion]=useState("");
 const [busy,setBusy]=useState(false);const busyRef=useRef(false);const pending=useRef<AbortController|null>(null);const [aiError,setAiError]=useState("");const [copied,setCopied]=useState(false);
 const current=workspace.items.find(i=>i.event.event_id===selected)??workspace.items[0];const currentId=current?.event.event_id;
 const threadKey=currentId?`${currentId}:${aiMode}`:"";const replies=chats[threadKey]??[];const chatEnd=useRef<HTMLDivElement>(null);
 const accept=useCallback((input:unknown)=>{
  try{const previous=stateRef.current;const batch=adaptIncoming(input,previous);const next=receiveBatch(previous,batch);stateRef.current=next;setWorkspace(next);
   const event=batch.records.find(r=>r.type==="event");if(event)setSelected(event.event_id);
   const duplicates=next.duplicateCount-previous.duplicateCount;
   setNotice(duplicates?`已忽略 ${duplicates} 則重送事件，沒有重複建立 incident。`:`已接收批次，共 ${next.items.length} 則獨立事件。`);setInputError("");return next;
  }catch(error){setInputError(error instanceof Error&&!("issues" in error)?error.message:"JSON 不符合介面草案。請確認 schema_version、records、時間與必要欄位。");throw error;}
 },[]);
 const simulate=useCallback((kind:Scenario)=>{
   const last=stateRef.current.batches.at(-1);if(kind==="duplicate"&&!last){setInputError("請先接收一組事件，再測試重送。");return;}
   const batch=kind==="duplicate"?last!:createFixture(kind,++seq.current);accept(batch);
 },[accept]);
 useEffect(()=>{const controller=new AbortController();fetch("/api/config",{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>setConfig(z.object({openai_configured:z.boolean(),model:z.string()}).parse(data))).catch(e=>{if(e.name!=="AbortError")setConfigError(true);});return()=>controller.abort();},[]);
 useEffect(()=>{
  const listener=(event:Event)=>{try{accept((event as CustomEvent).detail);}catch{/* visible validation error */}};
  window.addEventListener("rtdi:batch",listener);return()=>window.removeEventListener("rtdi:batch",listener);
 },[accept]);
 useEffect(()=>{chatEnd.current?.scrollIntoView({block:"nearest",behavior:"smooth"});},[replies.length,busy]);
 useEffect(()=>()=>pending.current?.abort(),[]);
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
   if(!current||!text.trim()||busyRef.current)return;const sent=text.trim();const context=current;const key=threadKey;const history=replies.slice(-10).map(({role,content})=>({role,content}));
   const controller=new AbortController();pending.current=controller;busyRef.current=true;setBusy(true);setAiError("");setQuestion("");
   try{const response=await fetch("/api/assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:aiMode,question:sent,context,history}),signal:controller.signal});
    const payload=await response.json();if(!response.ok){const failure=z.object({error:z.string()}).safeParse(payload);throw Error(failure.success?failure.data.error:"無法取得回答，請再試一次。");}
    const data=z.object({answer:z.string(),mode:z.enum(["demo","openai"]),model:z.string().nullable()}).parse(payload);
    setChats(prev=>({...prev,[key]:[...(prev[key]??[]),{role:"user",content:sent},{role:"assistant",content:data.answer,mode:data.mode,model:data.model}]}));
   }catch(error){if(error instanceof Error&&error.name!=="AbortError"){setAiError(error.message);setQuestion(sent);}}
   finally{if(pending.current===controller){pending.current=null;busyRef.current=false;setBusy(false);}}
 }
 function reset(){pending.current?.abort();pending.current=null;busyRef.current=false;setBusy(false);const fresh=emptyWorkspace();stateRef.current=fresh;setWorkspace(fresh);setSelected(null);setChats({});setAiError("");setInputError("");setQuestion("");setNotice("工作區已清空，沒有更動任何機台資料。");}
 const e=current?.evidence[0];const anomalies=new Set(workspace.items.map(i=>i.event.incident_id).filter(Boolean)).size;
 return <div className="shell"><header className="topbar"><a className="brand" href="/"><span className="brandmark"><Activity size={22}/></span> RTDI <span className="brandlight">Insight</span></a><div className="header-right"><a className="mode" href="/replay"><Activity size={14}/> 重播分析</a><span className="mode"><FlaskConical size={14}/> 本機原型</span><span className="team">G6</span></div></header>
 <main className="workspace"><div className="heading"><div><div className="eyebrow">GRP6 / PRODUCTION INTELLIGENCE</div><h1>每一個訊號，都有跡可循。</h1><p className="sub">接收測試事件、查看異常證據，與 AI 一起釐清下一步。</p></div><div className="receive-controls"><NativeSelect aria-label="模擬情境" value={scenario} onChange={ev=>setScenario(ev.target.value as Scenario)}>{Object.entries(scenarioLabels).map(([k,v])=><NativeSelectOption value={k} key={k}>{v}</NativeSelectOption>)}</NativeSelect><Button className="primary-action" onClick={()=>simulate(scenario)}><Radio size={17}/> 模擬接收 <ArrowUpRight size={16}/></Button></div></div>
 <div className="simulation-banner"><FlaskConical size={16}/><span>尚未連接 Gemini。內建範例皆為自造資料；AI 解讀不代表機台已收到訊息。</span><span className="banner-end">SIMULATION MODE</span></div>
 <div className="stats"><div><span>事件來源</span><strong>grp6 <small>Edge</small></strong><p>等待後端串接</p></div><div><span>獨立事件</span><strong>{String(workspace.items.length).padStart(2,"0")} <small>則事件</small></strong><p>{workspace.duplicateCount?`已忽略 ${workspace.duplicateCount} 則重送`:'本次瀏覽工作區'}</p></div><div><span>待調查 incident</span><strong className="orange">{String(anomalies).padStart(2,"0")}</strong><p>{anomalies?'依收到的 incident 標記':'等待異常事件'}</p></div><div><span>AI 助理</span><strong className="ai-stat">OpenAI <Sparkles size={20}/></strong><p>{configError?'設定狀態讀取失敗':config?.openai_configured?'已設定金鑰 · 尚待呼叫驗證':config?'未設定金鑰 · 可用示範解讀':'正在確認設定…'}</p></div></div>
 <div className="status-row"><span role="status" aria-live="polite">{notice||'準備就緒，選擇情境並模擬接收第一則 message。'}</span><Button variant="ghost" size="sm" onClick={reset} disabled={!workspace.items.length&&!inputError}><RotateCcw size={13}/> 重設</Button></div>
 {inputError&&<Alert variant="destructive" className="inline-error"><TriangleAlert/><AlertDescription>{inputError}</AlertDescription></Alert>}
 <div className="work-grid"><section className="panel evidence-panel"><div className="panel-header"><h2><Activity size={18}/> 事件與證據</h2><span className="mini-label">EVENT WORKSPACE</span></div>
 <Tabs defaultValue="evidence" className="event-tabs"><TabsList variant="line" aria-label="事件檢視"><TabsTrigger value="evidence">事件分析</TabsTrigger><TabsTrigger value="predictions">溫度預測</TabsTrigger><TabsTrigger value="message">Message JSON</TabsTrigger></TabsList>
 <TabsContent value="evidence">{!current?<div className="empty"><div className="empty-icon"><Radio size={30}/></div><h3>等待第一則 message</h3><p>從一則模擬機台事件，開始探索異常與證據。</p><Button variant="outline" onClick={()=>simulate("anomaly")}>接收示範事件 <ArrowUpRight size={16}/></Button></div>:<div className="event-body">
 <div className={`event-badge ${current.event.kind==='normal'?'normal-badge':current.event.kind==='missing_data'?'missing-badge':''}`}>{current.event.kind==='normal'?<Check size={14}/>:<TriangleAlert size={14}/>} {kindLabels[current.event.kind]}<span>· {modeLabels[current.event.mode]}</span></div>
 <h2>{current.incident?.title??kindLabels[current.event.kind]}</h2><p className="event-message">{current.event.message}</p>
 <div className="event-meta"><span>{current.event.wafer_id}</span><span>Site {current.event.site??'全部'}</span><span>{timeOf(current.event.occurred_at)} UTC+8</span></div>
 {e?<><div className="evidence-metrics"><div><span>{e.metric==='coverage'?'特徵完整度':e.metric==='measurement'?'觀測值':'窗口均值'}</span><strong>{e.observed===null?'—':e.metric==='coverage'?`${Math.round(e.observed*100)}%`:e.observed.toFixed(4)}<small>{e.metric==='coverage'?'':e.unit}</small></strong></div><div><span>參考基準</span><strong>{e.baseline??'—'}</strong></div><div><span>樣本數</span><strong>{e.sample_count}<small>筆</small></strong></div></div><Trend evidence={e}/><div className="evidence-foot"><span>{e.test_name}</span><span>Evidence · {e.evidence_id}</span></div>{e.missing_fields.length>0&&<div className="missing-fields"><Info size={15}/><span>缺少：{e.missing_fields.join(', ')}</span></div>}</>:<div className="no-chart"><Info/><strong>尚未收到對應 evidence</strong><span>請等待後續批次，不能僅依 message 確認根因。</span></div>}
 <div className="delivery"><div><Bell size={15}/><strong>機台回傳</strong><span>尚未建立命令</span></div><div className="delivery-steps"><span>訊息草稿</span><ChevronRight/><span>後端排隊</span><ChevronRight/><span>Edge 執行</span><ChevronRight/><span>機台回執</span></div><p>此原型不發送機台命令。AI 回答不會改變回傳狀態。</p></div>
 </div>}</TabsContent>
 <TabsContent value="predictions"><div className="prediction-body"><div className="section-title"><h3>六階段溫度預測</h3><span>與所選事件綁定</span></div><p className="sub">示範值不代表實際模型精度。回覆排隊與機台確認是不同狀態。</p>{current?.predictions.length?<div className="table-scroll"><table><thead><tr><th>階段</th><th>預測／實測</th><th>完整度</th><th>回覆狀態</th></tr></thead><tbody>{current.predictions.map(p=><tr key={p.prediction_id}><td><span className="stage-number">0{p.stage}</span></td><td><strong>{p.predicted?.toFixed(2)??'—'}</strong><span className="actual"> / {p.actual?.toFixed(2)??'—'}</span><small>{p.unit}</small></td><td>{p.coverage===null?'未知':`${Math.round(p.coverage*100)}%`}</td><td><span className={`prediction-status ${p.response_status==='insufficient_data'?'orange':''}`}>{responseLabels[p.response_status]}</span>{p.tester_receipt_id&&<small>{p.tester_receipt_id}</small>}</td></tr>)}</tbody></table></div>:<div className="no-chart"><Cpu/><strong>尚無預測紀錄</strong><span>接收一組 message 後，即可查看對應範例。</span></div>}</div></TabsContent>
 <TabsContent value="message"><div className="json-body"><div className="section-title"><h3>接收事件批次</h3><span>介面草案 v0.1</span></div><p className="sub">貼上與後端約定的 JSON，經過驗證與去重後更新同一個工作區。</p><label htmlFor="batch-json" className="field-label">Message JSON</label><Textarea id="batch-json" className="json-editor" value={raw} onChange={ev=>setRaw(ev.target.value)} placeholder={'{"schema_version":"0.1-draft","batch_id":"...","sent_at":"...","records":[...]}'} spellCheck={false}/><div className="json-actions"><Button variant="outline" onClick={()=>setRaw(JSON.stringify(createFixture("anomaly",++seq.current),null,2))}><FileJson2 size={15}/> 載入範例</Button><Button onClick={()=>{try{accept(JSON.parse(raw));}catch(error){if(error instanceof SyntaxError)setInputError("JSON 語法錯誤，請檢查括號、引號與逗號。");}}} disabled={!raw.trim()}><Radio size={15}/> 接收 JSON</Button></div>{current&&<details className="raw-details"><summary>查看目前事件原文</summary><pre>{JSON.stringify(current,null,2)}</pre><Button variant="ghost" size="sm" onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(current,null,2));setCopied(true);}catch{setNotice("複製失敗，請選取原文手動複製。");}}}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'已複製':'複製原文'}</Button></details>}</div></TabsContent></Tabs>
 {workspace.items.length>0&&<div className="event-inbox"><div className="section-title"><h3>接收紀錄</h3><span>{workspace.items.length} 則獨立事件</span></div><div className="inbox-list">{workspace.items.map(item=><button key={item.event.event_id} className={`inbox-item ${item.event.event_id===currentId?'selected':''}`} onClick={()=>{setSelected(item.event.event_id);setAiError("");setQuestion("");setCopied(false);}} aria-pressed={item.event.event_id===currentId}><span className={`inbox-symbol ${item.event.kind==='normal'?'normal':''}`}>{item.event.kind==='normal'?<Check size={15}/>:<Activity size={15}/>}</span><span><strong>{kindLabels[item.event.kind]}</strong><small>{item.event.wafer_id} · Site {item.event.site}</small></span><time>{timeOf(item.event.occurred_at)}</time><ChevronRight size={14}/></button>)}</div></div>}
 </section>
 <aside className="panel ai-panel"><div className="panel-header"><h2><Sparkles size={18}/> AI 調查助理</h2><span className="assistant-label">COPILOT</span></div><div className="ai-toolbar"><NativeSelect value={aiMode} aria-label="AI 回覆模式" onChange={ev=>{setAiMode(ev.target.value as "demo"|"openai");setAiError("");}} disabled={busy}><NativeSelectOption value="demo">示範解讀 · 固定規則</NativeSelectOption><NativeSelectOption value="openai">OpenAI · 真實 API</NativeSelectOption></NativeSelect><span>{aiMode==='demo'?'不呼叫 API':config?.openai_configured?'金鑰已設定':'待設定'}</span></div>
 <div className="chat-scroll" aria-live="polite">{!replies.length?<div className="assistant-intro"><span className="ai-icon"><Sparkles size={24}/></span><h3>{current?'一起看懂這則事件。':'從訊息，找到下一步。'}</h3><p>{current?'從觀察事實、可能原因到下一步，解讀都會引用目前事件的證據。':'接收事件後，即可查看解讀、追問原因與下一步。缺少證據時，助理會明確說明。'}</p>{current&&<div className="context-card"><span>目前調查</span><strong>{kindLabels[current.event.kind]} · Site {current.event.site}</strong><small>{current.event.event_id}</small></div>}<div className="suggestions">{prompts.map(p=><Button key={p} variant="outline" disabled={!current||busy} onClick={()=>ask(p)}>{p}<ArrowUpRight size={14}/></Button>)}</div><div className="ai-note"><Info size={14}/><span>{aiMode==='demo'?'示範解讀為固定規則，非 AI 生成。':'僅在送出問題時，將所選事件與此模式對話送往 OpenAI。'}</span></div></div>:<div className="messages">{replies.map((reply,i)=><div key={i} className={`chat-message ${reply.role}`}><div className="message-author">{reply.role==='assistant'?<Sparkles size={13}/>:null}{reply.role==='user'?'你':reply.mode==='demo'?'示範解讀 · 固定規則':`OpenAI · ${reply.model}`}</div><div className="message-text">{reply.content}</div></div>)}</div>}{busy&&<div className="thinking"><LoaderCircle size={15} className="spin"/> 正在整理所選事件的證據…</div>}<div ref={chatEnd}/></div>
 {aiError&&<Alert variant="destructive" className="ai-error"><TriangleAlert/><AlertDescription>{aiError}</AlertDescription></Alert>}
 <form className="composer" onSubmit={ev=>{ev.preventDefault();void ask(question);}}><Textarea aria-label="詢問 AI" placeholder={current?'詢問這則事件，例如：還缺哪些證據？':'先接收一則事件，再開始追問…'} value={question} onChange={ev=>setQuestion(ev.target.value)} disabled={!current||busy} maxLength={2000} onKeyDown={ev=>{if(ev.key==='Enter'&&!ev.shiftKey&&!ev.nativeEvent.isComposing){ev.preventDefault();void ask(question);}}}/><div className="composer-footer"><span>{aiMode==='demo'?'示範模式 · 不呼叫 OpenAI':'OpenAI Responses API'}</span><Button type="submit" size="icon" disabled={!current||busy||!question.trim()} aria-label="送出問題">{busy?<LoaderCircle className="spin" size={16}/>:<Send size={16}/>}</Button></div></form>
 </aside></div><footer><span><Bell size={13}/> 機台命令與回執通路尚未連接</span><span>RTDI Insight · grp6 / Prototype 0.1</span></footer></main></div>;
}
