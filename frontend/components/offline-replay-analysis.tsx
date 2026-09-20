"use client";
import {useLocale} from "@/components/locale-provider";
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Activity,ArrowUpRight,BookOpen,Check,ChevronRight,Copy,FileJson2,FlaskConical,Info,LoaderCircle,TriangleAlert,Upload} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Alert,AlertDescription} from '@/components/ui/alert';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {parseReplay,replayTotals,waferState,alertNames,formatObservation,replayChart,investigationText,type Replay,type ReplayAlert} from '@/lib/rtdi/replay';
import '@/app/replay/replay.css';
import {AppHeader} from '@/components/app-header';

import {ReplayArchiveNotice} from '@/components/connection-status';

import WaferScene from '@/components/wafer-scene';
import {waferEvaluation,replaySelection} from '@/lib/rtdi/ui-presentation';
import {readSourceSession,writeSourceSession,selectReplayView,updateReplaySelection,type ReplaySelection} from '@/lib/rtdi/source-session';
const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)','var(--chart-5)'];
function EvidencePlot({alert}:{alert:ReplayAlert}){
 const {t} = useLocale();

 const lines=replayChart(alert).map(line=>({...line,name:line.name.startsWith('Site ')?t('Site {0}',line.name.slice(5)):t(line.name)}));const values=lines.flatMap(l=>l.values);if(!values.length)return <div className="no-chart">{t("No sequence supplied. A chart is unavailable.")}</div>;
 const yieldMode=alert.kind==='low_yield';const reference=yieldMode?alert.reference:alert.baseline?.mean;
 const all=[...values,...(reference===undefined?[]:[reference])];const low=all.reduce((m,v)=>Math.min(m,v),Infinity),high=all.reduce((m,v)=>Math.max(m,v),-Infinity);const padding=Math.max((high-low)*.13,.001);
 const min=yieldMode?0:low-padding,max=yieldMode?Math.max(1,high):high+padding;
 const y=(v:number)=>215-(v-min)/(max-min)*180;const count=Math.max(...lines.map(l=>l.values.length));const x=(i:number)=>60+i/Math.max(count-1,1)*560;
 return <div className="replay-plot"><div className="plot-caption"><strong>{yieldMode ? t("Cumulative yield") : t("Measurement sequences")}</strong><span>{yieldMode ? t("Percent") : t("Raw values · units unverified")}</span></div><svg viewBox="0 0 650 260" role="img" aria-label={t("{0}; {1}; x-axis is sample order, not time.", t(alertNames[alert.kind]), lines.map(l=>l.name).join(', '))}>
 {[0,1,2,3,4].map(i=>{const value=min+(max-min)*i/4;return <g key={i}><path d={`M60 ${y(value)}H620`} stroke="var(--border)"/><text x="49" y={y(value)+4} textAnchor="end">{yieldMode ? `${(value*100).toFixed(0)}%` : value.toFixed(2)}</text></g>})}
 {reference!==undefined && <g><path d={`M60 ${y(reference)}H620`} stroke="var(--muted-foreground)" strokeDasharray="5 5"/><text x="620" y={y(reference)-7} textAnchor="end">{yieldMode ? t("Yield threshold") : t("Baseline mean")} {yieldMode ? `${(reference*100).toFixed(0)}%` : reference.toFixed(3)}</text></g>}
 {lines.map((line,k)=><g key={line.name}><path d={line.values.map((v,i)=>`${i?'L':'M'}${x(i)} ${y(v)}`).join(' ')} stroke={colors[k%colors.length]} strokeWidth="2.4" fill="none" strokeLinejoin="round"/>{line.values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r={count>100?1:2} fill={colors[k%colors.length]}><title>{line.name} {t("· sample")}{i+1}: {t(v)}</title></circle>)}</g>)}
 {[0,Math.floor((count-1)/2),count-1].map((i,k)=><text key={k} x={x(i)} y="239" textAnchor="middle">{i+1}</text>)}
 </svg><div className="plot-legend">{lines.map((l,i)=><span key={l.name}><i style={{background:colors[i%colors.length]}}/>{t(l.name)}</span>)}<span className="axis-note">{yieldMode ? t("Completed-device order") : t("Sample order within each site")} {t("· no timestamps")}</span></div></div>;
}
export function OfflineReplayAnalysis({sourceChooser,restoreImport=false,onSourceChange}:{sourceChooser:ReactNode|((loadBundled:()=>void)=>ReactNode);restoreImport?:boolean;onSourceChange?:(view:'bundled'|'imported')=>void}){
 const {t} = useLocale();
 const [saved]=useState(()=>{
  if(!restoreImport)return null;
  const replay=readSourceSession()?.replay;
  if(!replay)return null;
  const waferId=replaySelection(replay.data.wafers,replay.selection.waferId,replay.selection.filter);
  const wafer=replay.data.wafers.find(w=>w.wafer===waferId);
  return {...replay,selection:{...replay.selection,waferId,alertIndex:Math.min(replay.selection.alertIndex,Math.max(0,(wafer?.alerts.length??0)-1))}};
 });

 const [data,setData]=useState<Replay|null>(saved?.data??null),[source,setSource]=useState(saved?`Local import · ${saved.filename}`:''),[loading,setLoading]=useState(!saved),[error,setError]=useState('');
 const [waferId,setWaferId]=useState(saved?.selection.waferId??'1'),[alertIndex,setAlertIndex]=useState(saved?.selection.alertIndex??0),[filter,setFilter]=useState(saved?.selection.filter??'all'),[copied,setCopied]=useState(false);
 const [detailOpen,setDetailOpen]=useState(saved?.selection.detailOpen??true),[tab,setTab]=useState(saved?.selection.tab??'analysis'),[copyPending,setCopyPending]=useState(false),[copyError,setCopyError]=useState('');
 const fileRef=useRef<HTMLInputElement>(null),requestSeq=useRef(0),copySeq=useRef(0),request=useRef<AbortController|null>(null);
 const resetCopy=useCallback(()=>{copySeq.current++;setCopied(false);setCopyPending(false);setCopyError('');},[]);
 function persistSelection(patch:Partial<ReplaySelection>){
  if(!source.startsWith('Local import · '))return;
  try{updateReplaySelection({waferId,alertIndex,filter,tab,detailOpen,...patch});}
  catch{setError('Browser storage is unavailable or full. Your latest selection could not be saved.');}
 }
 function tileClick(id:string){if(id===waferId){setDetailOpen(!detailOpen);persistSelection({detailOpen:!detailOpen});}else selectWafer(id);}
 function selectWafer(id:string,patch:Partial<ReplaySelection>={}){setDetailOpen(true);setWaferId(id);setAlertIndex(0);resetCopy();persistSelection({waferId:id,alertIndex:0,detailOpen:true,...patch});}
 const accept=useCallback((input:unknown,name:string)=>{
  // Validate the entire replacement before changing the displayed dataset.
  const parsed=parseReplay(input);setData(parsed);setSource(name);setWaferId(parsed.wafers[0].wafer);setAlertIndex(0);setDetailOpen(true);resetCopy();setFilter('all');setTab('analysis');setError('');
 },[resetCopy]);
 function beginRequest(){request.current?.abort();request.current=null;const n=++requestSeq.current;setLoading(true);setError('');resetCopy();return n;}
 const requestProject=useCallback(async(n:number,controller:AbortController,replaceImport=false)=>{
  try{
   const r=await fetch('/replay/summary.json',{signal:controller.signal,cache:'no-store'});
   if(!r.ok)throw Error(`Snapshot request failed (HTTP ${r.status}).`);
   const value=parseReplay(await r.json());if(n===requestSeq.current){
    if(replaceImport){
     try{selectReplayView('bundled');}
     catch{setError('Browser storage is unavailable or full. The source could not be changed; your previous dataset is retained.');return;}
    }
     accept(value,'Bundled snapshot · /replay/summary.json');
     onSourceChange?.('bundled');
   }
  }catch(err){
   if(n===requestSeq.current)setError(`${err instanceof Error&&err.message.startsWith('Snapshot request failed')?err.message:'Could not load a valid replay snapshot.'} Retry or import a replay summary. Any previous dataset is retained.`);
  }finally{if(n===requestSeq.current){request.current=null;setLoading(false);}}
 },[accept,onSourceChange]);
 function loadProject(replaceImport=false){
  const n=beginRequest();const controller=new AbortController();request.current=controller;
  return requestProject(n,controller,replaceImport);
 }
 useEffect(()=>{
  const requests=requestSeq,copies=copySeq,pending=request;
  if(!saved){
   const n=++requests.current,controller=new AbortController();pending.current=controller;
   void requestProject(n,controller);
  }
  return()=>{requests.current++;copies.current++;pending.current?.abort();};
 },[saved,requestProject]);
 async function importFile(file:File){
  const n=beginRequest();
  try{
   if(file.size>5*1024*1024)throw Error('File exceeds 5 MiB. Import a summary, not raw measurements.');
   const value=parseReplay(JSON.parse(await file.text()));if(n===requestSeq.current){
    try{writeSourceSession({version:1,mode:'summary',replayView:'imported',replay:{data:value,filename:file.name,selection:{waferId:value.wafers[0].wafer,alertIndex:0,filter:'all',tab:'analysis',detailOpen:true}}});}
    catch{setError('Browser storage is unavailable or full. The import was not applied; your previous dataset is retained.');return;}
    accept(value,`Local import · ${file.name}`);
    onSourceChange?.('imported');
   }
  }catch(err){
   if(n===requestSeq.current)setError(`${err instanceof Error&&err.message.startsWith('File exceeds')?err.message:'Invalid summary. Supply valid replay JSON with unique wafer IDs, wafers, validation and limitations.'} Any previous dataset is retained.`);
  }finally{if(n===requestSeq.current)setLoading(false);}
 }
 const total=data?replayTotals(data):null;const wafer=data?.wafers.find(w=>w.wafer===waferId);const alert=wafer?.alerts[alertIndex];
 const displayed=data?.wafers.filter(w=>filter==='all'||waferState(w)===filter)??[];
 function nextWafer(){if(!displayed.length)return;const i=displayed.findIndex(w=>w.wafer===waferId);selectWafer(displayed[(i+1)%displayed.length].wafer,{tab:'analysis'});setTab('analysis');}
 async function copyEvidence(){
  if(!wafer||!alert||loading||copyPending)return;
  const n=++copySeq.current;setCopyPending(true);setCopied(false);setCopyError('');
  const text=`Source: ${source}\nLocal reference: wafer_id=${wafer.wafer}, alerts[${alertIndex}] (not a backend event ID)\n\n${investigationText(wafer.wafer,alert)}`;
  try{await navigator.clipboard.writeText(text);if(n===copySeq.current)setCopied(true);}
  catch{if(n===copySeq.current)setCopyError('Clipboard unavailable. Expand the source alert fields below to copy the evidence manually.');}
  finally{if(n===copySeq.current)setCopyPending(false);}
 }
 return <div className="shell replay-shell"><AppHeader active="replay"/>
 <main id="main-content" className="workspace replay-workspace" aria-busy={loading}>{typeof sourceChooser==='function'?sourceChooser(()=>void loadProject(true)):sourceChooser}<div className="heading"><div><div className="eyebrow">{t("EVIDENCE REVIEW / REPLAY")}</div><h1>{t("Wafer Analysis")}</h1><p className="sub">{t("Inspect recorded alerts, site measurements and model validation.")}</p></div><div className="replay-actions"><Button variant="outline" onClick={()=>fileRef.current?.click()}><Upload size={16}/> {t("Import summary")}</Button><Button onClick={nextWafer} disabled={loading||displayed.length<2}><BookOpen size={16}/>{t("Next wafer")}<ChevronRight size={15}/></Button><Input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-label={t("Import replay summary JSON")} onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/></div></div>
 <ReplayArchiveNotice/>
 <WaferScene waferId={wafer?.wafer} yieldRatio={wafer?.yield} devices={wafer?.devices}/>
 <div className="simulation-banner replay-banner"><FlaskConical size={16}/><span><strong>{t("REPLAY")}</strong> {t("· Historical replay. Live operation and tester receipt are unverified.")}</span><span className="banner-end">{t("OFFLINE EVIDENCE")}</span></div>
 <div data-tour-local-import={source.startsWith('Local import')?'true':'false'} className="replay-source"><span><FileJson2 size={14}/>{source?(source.startsWith('Local import · ')?t('Local import · {0}',source.slice(15)):t(source)):t(loading?'Loading bundled snapshot…':'No summary loaded')}</span><Button variant="ghost" size="sm" onClick={()=>void loadProject(true)} disabled={loading}>{t("Use bundled example")}</Button></div>
 {error && <Alert variant="destructive" className="inline-error"><TriangleAlert/><AlertDescription>{t(error)}</AlertDescription></Alert>}
 {loading && <div role="status" className="loading-replay"><LoaderCircle className="spin" size={18}/> {t("Validating replay summary…")}</div>}
 {data&&total && <><div className="replay-overview"><div className="stats" aria-label={t("Replay summary")}><div><span>{t("Dataset")}</span><strong>{data.wafers.length}<small>{t("wafers")}</small></strong><p>{total.devices.toLocaleString()} {t("completed devices")}</p></div><div><span>{t("Recorded alerts")}</span><strong>{total.alerts}<small>{t("records")}</small></strong><p>{t("Across")}{total.alertedWafers} {t("wafers")}</p></div><div><span>{t("Source mode")}</span><strong>{t("REPLAY")}</strong><p>{t("Schema-validated historical summary")}</p></div><div><span>{t("Tester receipt")}</span><strong>{t("Not provided")}</strong><p>{t("No receipt in this summary")}</p></div></div></div>
 <section className="run-analysis-coverage"><h2>{t('Yield & measurement coverage')}</h2><p>{t('Archive yield uses completed-device results for each wafer. Raw measurement coverage is not supplied by summary.json.')}</p></section>
 <Tabs value={tab} onValueChange={value=>{setTab(value);persistSelection({tab:value});}} className="replay-tabs"><TabsList variant="line"><TabsTrigger value="analysis">{t("Wafers & alerts")}</TabsTrigger><TabsTrigger value="validation">{t("Model validation")}</TabsTrigger><TabsTrigger value="limitations">{t("Limitations")}</TabsTrigger></TabsList>
 <TabsContent value="analysis"><div className="replay-grid"><aside className="panel wafer-panel"><div className="panel-header"><h2>{t("Wafers")}</h2><NativeSelect size="sm" aria-label={t("Filter wafers")} disabled={loading} value={filter} onChange={e=>{const value=e.target.value;setFilter(value);const selected=replaySelection(data?.wafers??[],waferId,value);if(selected!==waferId)selectWafer(selected,{filter:value});else persistSelection({filter:value});}}><NativeSelectOption value="all">{t("All")}</NativeSelectOption><NativeSelectOption value="alert">{t("With alerts")}</NativeSelectOption><NativeSelectOption value="quiet">{t("No alerts")}</NativeSelectOption></NativeSelect></div><p className="wafer-hint">{t("Source order · yield and alert counts. This is not a spatial wafer map.")}</p><div className="wafer-tiles">{displayed.map(w=><button key={w.wafer} className={`wafer-tile ${waferState(w)} ${w.wafer===waferId?'active':''}`} aria-label={t("W{0}, yield {1}%, {2} alerts", w.wafer, (w.yield*100).toFixed(1), w.alerts.length)} aria-pressed={w.wafer===waferId} aria-expanded={w.wafer===waferId?detailOpen:false} aria-controls={w.wafer===waferId?'replay-wafer-detail':undefined} disabled={loading} onClick={()=>tileClick(w.wafer)}><strong>W{w.wafer.padStart(2,'0')}</strong><span>{(w.yield*100).toFixed(1)}%</span><small>{w.alerts.length ? t("{0} alerts", w.alerts.length) : t("No alerts")}</small></button>)}</div>{!displayed.length&&<p className="wafer-hint">{t("No wafers match this filter.")}</p>}<div className="wafer-legend"><span><i/>{t("With alerts")}</span><span>{t("Grouped by recorded alerts only")}</span></div></aside>
 {wafer&&<section id="replay-wafer-detail" hidden={!detailOpen} className="panel replay-detail"><div className="panel-header"><h2><Activity size={18}/> W{wafer.wafer} <span className="detail-site-label">/ {wafer.devices} {t("devices")}</span></h2><span className="mini-label">{t("REPLAY")}</span></div><div className="wafer-summary"><div><span>{t("Cumulative yield")}</span><strong>{(wafer.yield*100).toFixed(2)}<small>%</small></strong></div><div><span>{t("Dataset label")}</span><strong className="label-value">{t(alertNames[wafer.expected]) ?? wafer.expected}</strong><p>{t("Evaluation only; not a detector rule")}</p></div><div><span>{t("Alerts")}</span><strong>{wafer.alerts.length}<small>{t("records")}</small></strong></div></div>
 {waferEvaluation(wafer)&&<div className="wafer-warning" role="note"><Info size={17}/><span>{wafer.expected_first_device===null?t(waferEvaluation(wafer)):t('Source evaluation: expected category detected at device {0}.',wafer.expected_first_device)}</span></div>}{!wafer.alerts.length?<div className="empty replay-empty"><CircleIcon/><h3>{t("No alerts recorded for this wafer")}</h3><p>{t("No alerts does not establish normal operation. Review the source evaluation and limitations.")}</p></div>:<><div className="alert-selector" role="group" aria-label={t("Select alert evidence")}>{wafer.alerts.map((a,i)=><Button key={i} variant={i===alertIndex?'secondary':'ghost'} size="sm" aria-pressed={i===alertIndex} disabled={loading} onClick={()=>{setAlertIndex(i);resetCopy();persistSelection({alertIndex:i});}}>{t(alertNames[a.kind])}<span>#{i+1}</span></Button>)}</div>{alert&&<div className="selected-evidence"><div className="selected-title"><h3>{t(alertNames[alert.kind])} <span>{t("Site")}{alert.site==='all' ? t("All") : alert.site}</span></h3><span>{t("Detected after")}{alert.completed_devices} {t("devices")}</span></div><p className="original-message">{alert.message}</p><div className="alert-values"><div><span>{t("Observed")}</span><strong>{formatObservation(alert,alert.observed)}</strong></div><div><span>{t("Reference")}</span><strong>{formatObservation(alert,alert.reference)}</strong></div><div><span>{t("Detector score")}</span><strong>{alert.score.toFixed(3)}</strong><small>{t("Not a probability")}</small></div></div><EvidencePlot alert={alert}/><div className="evidence-foot"><span>{t("Test ·")}{alert.test}</span><span>{t("Local reference · wafer_id=")}{wafer.wafer}{t(", alerts[")}{alertIndex}{t("] (not a backend event ID)")}</span></div><div className="investigation"><div><BookOpen size={16}/><strong>{t("Investigation guidance")}</strong><span>{t("Source detector text · not LLM-generated")}</span></div><p>{alert.suggestion}</p><Button variant="outline" size="sm" disabled={loading||copyPending} onClick={copyEvidence}>{copied?<Check size={14}/>:<Copy size={14}/>} {copyPending ? t("Copying…") : copied ? t("Copied") : t("Copy handoff")}</Button><span className="copy-status" role="status">{copied ? t("Handoff copied to clipboard.") : ''}</span>{copyError&&<p className="copy-error" role="alert">{t(copyError)}</p>}</div><details className="raw-details"><summary>{t("View source alert fields")}</summary><pre>{JSON.stringify(alert,null,2)}</pre></details></div>}</>}
 </section>}{!wafer&&<section className="panel empty replay-empty" role="status"><CircleIcon/><h2>{t("No wafer selected")}</h2><p>{t("Change the wafer filter to select evidence.")}</p></section>}</div></TabsContent>
 <TabsContent value="validation"><section className="panel model-panel"><div className="panel-header"><h2>{t("Six-stage model validation")}</h2><span className="mini-label">{data.validation.mode ?? t("Validation method not provided")}</span></div><div className="model-intro"><h3>{t("Validation error by stage")}</h3><p>{t("Metrics come from validation.metrics. In-sample replay error is excluded. Physical temperature units are unverified; values use CSV units.")}</p></div><div className="table-scroll" tabIndex={0} role="region" aria-label={t("Model validation table; scroll horizontally")}><table><thead><tr><th>{t("Stage")}</th><th>{t("Samples")}</th><th>{t("Model MAE")}</th><th>{t("Baseline MAE")}</th><th>RMSE</th><th>{t("Worst error")}</th></tr></thead><tbody>{[1,2,3,4,5,6].map(stage=>{const m=data.validation.metrics[String(stage)];return <tr key={stage}><td><span className="stage-number">0{stage}</span></td><td>{m?.n.toLocaleString() ?? t("Not provided")}</td><td className="model-mae">{m?.mae.toFixed(5) ?? '—'}</td><td>{m?.baseline_mae.toFixed(5) ?? '—'}</td><td>{m?.rmse.toFixed(5) ?? '—'}</td><td>{m?.worst_error.toFixed(5) ?? '—'}</td></tr>})}</tbody></table></div><div className="validation-note"><Info size={17}/><p>{t("Dataset metrics do not establish live prediction accuracy, latency or tester receipt. Full feature coverage does not imply perfect accuracy.")}</p></div></section></TabsContent>
 <TabsContent value="limitations"><section className="panel limitations-panel"><h2>{t("Dataset limitations")}</h2><div className="limitations-content"><h3>{t("Limitations")}</h3>{data.limitations.length?<ul>{data.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul>:<p>{t("None supplied.")}</p>}<h3>{t("Live integration — source report")}</h3><p className="replay-integration-value">{data.live_integration}</p></div></section></TabsContent></Tabs>
 <footer><span><FlaskConical size={13} aria-hidden="true"/><span>{source.startsWith('Local import · ')?t('Local import · {0}',source.slice(15)):t(source)} {source.startsWith('Local import · ')?t("· Saved in this browser tab"):''}</span></span><a href="/workspace">{t("Run workspace")}<ArrowUpRight size={13}/></a></footer></>}
 </main></div>;
}
function CircleIcon(){return <div className="empty-icon"><Info size={27}/></div>;}
