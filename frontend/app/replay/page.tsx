"use client";
import {useEffect,useRef,useState} from 'react';
import {Activity,ArrowLeft,ArrowUpRight,BookOpen,Check,ChevronRight,Copy,FileJson2,FlaskConical,Info,LoaderCircle,TriangleAlert,Upload} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Alert,AlertDescription} from '@/components/ui/alert';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {parseReplay,replayTotals,waferState,alertNames,formatObservation,replayChart,investigationText,type Replay,type ReplayAlert} from '@/lib/rtdi/replay';
import './replay.css';
import {ThemeSelector} from '@/components/theme-controls';
import {waferEvaluation,replaySelection} from '@/lib/rtdi/ui-presentation';
const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)','var(--chart-5)'];
function EvidencePlot({alert}:{alert:ReplayAlert}){
 const lines=replayChart(alert);const values=lines.flatMap(l=>l.values);if(!values.length)return <div className="no-chart">No sequence supplied. A chart is unavailable.</div>;
 const yieldMode=alert.kind==='low_yield';const reference=yieldMode?alert.reference:alert.baseline?.mean;
 const all=[...values,...(reference===undefined?[]:[reference])];const low=all.reduce((m,v)=>Math.min(m,v),Infinity),high=all.reduce((m,v)=>Math.max(m,v),-Infinity);const padding=Math.max((high-low)*.13,.001);
 const min=yieldMode?0:low-padding,max=yieldMode?Math.max(1,high):high+padding;
 const y=(v:number)=>215-(v-min)/(max-min)*180;const count=Math.max(...lines.map(l=>l.values.length));const x=(i:number)=>60+i/Math.max(count-1,1)*560;
 return <div className="replay-plot"><div className="plot-caption"><strong>{yieldMode?'Cumulative yield':'Measurement sequences'}</strong><span>{yieldMode?'Percent':'Raw values · units unverified'}</span></div><svg viewBox="0 0 650 260" role="img" aria-label={`${alertNames[alert.kind]}; ${lines.map(l=>l.name).join(', ')}; x-axis is sample order, not time.`}>
 {[0,1,2,3,4].map(i=>{const value=min+(max-min)*i/4;return <g key={i}><path d={`M60 ${y(value)}H620`} stroke="var(--border)"/><text x="49" y={y(value)+4} textAnchor="end">{yieldMode?`${(value*100).toFixed(0)}%`:value.toFixed(2)}</text></g>})}
 {reference!==undefined&&<g><path d={`M60 ${y(reference)}H620`} stroke="var(--muted-foreground)" strokeDasharray="5 5"/><text x="620" y={y(reference)-7} textAnchor="end">{yieldMode?'Yield threshold':'Baseline mean'} {yieldMode?`${(reference*100).toFixed(0)}%`:reference.toFixed(3)}</text></g>}
 {lines.map((line,k)=><g key={line.name}><path d={line.values.map((v,i)=>`${i?'L':'M'}${x(i)} ${y(v)}`).join(' ')} stroke={colors[k%colors.length]} strokeWidth="2.4" fill="none" strokeLinejoin="round"/>{line.values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r={count>100?1:2} fill={colors[k%colors.length]}><title>{line.name} · sample {i+1}: {v}</title></circle>)}</g>)}
 {[0,Math.floor((count-1)/2),count-1].map((i,k)=><text key={k} x={x(i)} y="239" textAnchor="middle">{i+1}</text>)}
 </svg><div className="plot-legend">{lines.map((l,i)=><span key={l.name}><i style={{background:colors[i%colors.length]}}/>{l.name}</span>)}<span className="axis-note">{yieldMode?'Completed-device order':'Sample order within each site'} · no timestamps</span></div></div>;
}
export default function ReplayPage(){
 const [data,setData]=useState<Replay|null>(null),[source,setSource]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [waferId,setWaferId]=useState('1'),[alertIndex,setAlertIndex]=useState(0),[filter,setFilter]=useState('all'),[copied,setCopied]=useState(false);
 const [tab,setTab]=useState('analysis'),[copyPending,setCopyPending]=useState(false),[copyError,setCopyError]=useState('');
 const fileRef=useRef<HTMLInputElement>(null),requestSeq=useRef(0),copySeq=useRef(0),request=useRef<AbortController|null>(null);
 function resetCopy(){copySeq.current++;setCopied(false);setCopyPending(false);setCopyError('');}
 function selectWafer(id:string){setWaferId(id);setAlertIndex(0);resetCopy();}
 function accept(input:unknown,name:string){
  // Validate the entire replacement before changing the displayed dataset.
  const parsed=parseReplay(input);setData(parsed);setSource(name);selectWafer(parsed.wafers[0].wafer);setFilter('all');setTab('analysis');setError('');
 }
 function beginRequest(){request.current?.abort();request.current=null;const n=++requestSeq.current;setLoading(true);setError('');resetCopy();return n;}
 async function loadProject(){
  const n=beginRequest();const controller=new AbortController();request.current=controller;
  try{
   const r=await fetch('/replay/summary.json',{signal:controller.signal,cache:'no-store'});
   if(!r.ok)throw Error(`Snapshot request failed (HTTP ${r.status}).`);
   const value=await r.json();if(n===requestSeq.current)accept(value,'Bundled snapshot · /replay/summary.json');
  }catch(err){
   if(n===requestSeq.current)setError(`${err instanceof Error&&err.message.startsWith('Snapshot request failed')?err.message:'Could not load a valid replay snapshot.'} Retry or import a replay summary. Any previous dataset is retained.`);
  }finally{if(n===requestSeq.current){request.current=null;setLoading(false);}}
 }
 useEffect(()=>{void loadProject();return()=>{requestSeq.current++;copySeq.current++;request.current?.abort();};},[]);
 async function importFile(file:File){
  const n=beginRequest();
  try{
   if(file.size>5*1024*1024)throw Error('File exceeds 5 MiB. Import a summary, not raw measurements.');
   const value=JSON.parse(await file.text());if(n===requestSeq.current)accept(value,`Local import · ${file.name}`);
  }catch(err){
   if(n===requestSeq.current)setError(`${err instanceof Error&&err.message.startsWith('File exceeds')?err.message:'Invalid summary. Supply valid replay JSON with unique wafer IDs, wafers, validation and limitations.'} Any previous dataset is retained.`);
  }finally{if(n===requestSeq.current)setLoading(false);}
 }
 const total=data?replayTotals(data):null;const wafer=data?.wafers.find(w=>w.wafer===waferId);const alert=wafer?.alerts[alertIndex];
 const displayed=data?.wafers.filter(w=>filter==='all'||waferState(w)===filter)??[];
 function nextWafer(){if(!displayed.length)return;const i=displayed.findIndex(w=>w.wafer===waferId);selectWafer(displayed[(i+1)%displayed.length].wafer);setTab('analysis');}
 async function copyEvidence(){
  if(!wafer||!alert||loading||copyPending)return;
  const n=++copySeq.current;setCopyPending(true);setCopied(false);setCopyError('');
  const text=`Source: ${source}\nLocal reference: wafer_id=${wafer.wafer}, alerts[${alertIndex}] (not a backend event ID)\n\n${investigationText(wafer.wafer,alert)}`;
  try{await navigator.clipboard.writeText(text);if(n===copySeq.current)setCopied(true);}
  catch{if(n===copySeq.current)setCopyError('Clipboard unavailable. Expand the source alert fields below to copy the evidence manually.');}
  finally{if(n===copySeq.current)setCopyPending(false);}
 }
 return <div className="shell"><header className="topbar"><a className="brand" href="/"><span className="brandmark"><Activity size={22}/></span> RTDI <span className="brandlight">Insight</span></a><div className="header-right"><ThemeSelector/><a className="return-link" href="/"><ArrowLeft size={14}/> Investigation console</a><span className="team">G6</span></div></header>
 <main className="workspace replay-workspace" aria-busy={loading}><div className="heading"><div><div className="eyebrow">EVIDENCE REVIEW / REPLAY</div><h1>Replay analysis</h1><p className="sub">Inspect recorded alerts, site measurements and model validation.</p></div><div className="replay-actions"><Button variant="outline" onClick={()=>fileRef.current?.click()}><Upload size={16}/> Import summary</Button><Button onClick={nextWafer} disabled={loading||displayed.length<2}><BookOpen size={16}/>Next wafer<ChevronRight size={15}/></Button><Input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-label="Import replay summary JSON" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/></div></div>
 <div className="simulation-banner replay-banner"><FlaskConical size={16}/><span><strong>REPLAY</strong> · Historical replay. Live operation and tester receipt are unverified.</span><span className="banner-end">OFFLINE EVIDENCE</span></div>
 <div className="replay-source"><span><FileJson2 size={14}/>{source||(loading?'Loading bundled snapshot…':'No summary loaded')}</span><Button variant="ghost" size="sm" onClick={()=>void loadProject()} disabled={loading}>Reload snapshot</Button></div>
 {error&&<Alert variant="destructive" className="inline-error"><TriangleAlert/><AlertDescription>{error}</AlertDescription></Alert>}
 {loading&&<div role="status" className="loading-replay"><LoaderCircle className="spin" size={18}/> Validating replay summary…</div>}
 {data&&total&&<><div className="stats"><div><span>Dataset</span><strong>{data.wafers.length}<small>wafers</small></strong><p>{total.devices.toLocaleString()} completed devices</p></div><div><span>Recorded alerts</span><strong>{total.alerts}<small>records</small></strong><p>Across {total.alertedWafers} wafers</p></div><div><span>Source mode</span><strong>REPLAY</strong><p>Schema-validated historical summary</p></div><div><span>Tester receipt</span><strong>Not provided</strong><p>No receipt in this summary</p></div></div>
 <Tabs value={tab} onValueChange={setTab} className="replay-tabs"><TabsList variant="line"><TabsTrigger value="analysis">Wafers & alerts</TabsTrigger><TabsTrigger value="validation">Model validation</TabsTrigger><TabsTrigger value="limitations">Limitations</TabsTrigger></TabsList>
 <TabsContent value="analysis"><div className="replay-grid"><aside className="panel wafer-panel"><div className="panel-header"><h2>Wafers</h2><NativeSelect size="sm" aria-label="Filter wafers" disabled={loading} value={filter} onChange={e=>{const value=e.target.value;setFilter(value);const selected=replaySelection(data?.wafers??[],waferId,value);if(selected!==waferId)selectWafer(selected);}}><NativeSelectOption value="all">All</NativeSelectOption><NativeSelectOption value="alert">With alerts</NativeSelectOption><NativeSelectOption value="quiet">No alerts</NativeSelectOption></NativeSelect></div><p className="wafer-hint">Source order · yield and alert counts. This is not a spatial wafer map.</p><div className="wafer-tiles">{displayed.map(w=><button key={w.wafer} className={`wafer-tile ${waferState(w)} ${w.wafer===waferId?'active':''}`} aria-label={`W${w.wafer}, yield ${(w.yield*100).toFixed(1)}%, ${w.alerts.length} alerts`} aria-pressed={w.wafer===waferId} disabled={loading} onClick={()=>selectWafer(w.wafer)}><strong>W{w.wafer.padStart(2,'0')}</strong><span>{(w.yield*100).toFixed(1)}%</span><small>{w.alerts.length?`${w.alerts.length} alerts`:'No alerts'}</small></button>)}</div>{!displayed.length&&<p className="wafer-hint">No wafers match this filter.</p>}<div className="wafer-legend"><span><i/>With alerts</span><span>Grouped by recorded alerts only</span></div></aside>
 {wafer&&<section className="panel replay-detail"><div className="panel-header"><h2><Activity size={18}/> W{wafer.wafer} <span className="detail-site-label">/ {wafer.devices} devices</span></h2><span className="mini-label">REPLAY</span></div><div className="wafer-summary"><div><span>Cumulative yield</span><strong>{(wafer.yield*100).toFixed(2)}<small>%</small></strong></div><div><span>Dataset label</span><strong className="label-value">{alertNames[wafer.expected]??wafer.expected}</strong><p>Evaluation only; not a detector rule</p></div><div><span>Alerts</span><strong>{wafer.alerts.length}<small>records</small></strong></div></div>
 {waferEvaluation(wafer)&&<div className="wafer-warning" role="note"><Info size={17}/><span>{waferEvaluation(wafer)}</span></div>}{!wafer.alerts.length?<div className="empty replay-empty"><CircleIcon/><h3>No alerts recorded for this wafer</h3><p>No alerts does not establish normal operation. Review the source evaluation and limitations.</p></div>:<><div className="alert-selector" role="group" aria-label="Select alert evidence">{wafer.alerts.map((a,i)=><Button key={i} variant={i===alertIndex?'secondary':'ghost'} size="sm" aria-pressed={i===alertIndex} disabled={loading} onClick={()=>{setAlertIndex(i);resetCopy();}}>{alertNames[a.kind]}<span>#{i+1}</span></Button>)}</div>{alert&&<div className="selected-evidence"><div className="selected-title"><h3>{alertNames[alert.kind]} <span>Site {alert.site==='all'?'All':alert.site}</span></h3><span>Detected after {alert.completed_devices} devices</span></div><p className="original-message">{alert.message}</p><div className="alert-values"><div><span>Observed</span><strong>{formatObservation(alert,alert.observed)}</strong></div><div><span>Reference</span><strong>{formatObservation(alert,alert.reference)}</strong></div><div><span>Detector score</span><strong>{alert.score.toFixed(3)}</strong><small>Not a probability</small></div></div><EvidencePlot alert={alert}/><div className="evidence-foot"><span>Test · {alert.test}</span><span>Local reference · wafer_id={wafer.wafer}, alerts[{alertIndex}] (not a backend event ID)</span></div><div className="investigation"><div><BookOpen size={16}/><strong>Investigation guidance</strong><span>Source detector text · not LLM-generated</span></div><p>{alert.suggestion}</p><Button variant="outline" size="sm" disabled={loading||copyPending} onClick={copyEvidence}>{copied?<Check size={14}/>:<Copy size={14}/>} {copyPending?'Copying…':copied?'Copied':'Copy handoff'}</Button><span className="copy-status" role="status">{copied?'Handoff copied to clipboard.':''}</span>{copyError&&<p className="copy-error" role="alert">{copyError}</p>}</div><details className="raw-details"><summary>View source alert fields</summary><pre>{JSON.stringify(alert,null,2)}</pre></details></div>}</>}
 </section>}{!wafer&&<section className="panel empty replay-empty" role="status"><CircleIcon/><h2>No wafer selected</h2><p>Change the wafer filter to select evidence.</p></section>}</div></TabsContent>
 <TabsContent value="validation"><section className="panel model-panel"><div className="panel-header"><h2>Six-stage model validation</h2><span className="mini-label">{data.validation.mode??'Validation method not provided'}</span></div><div className="model-intro"><h3>Validation error by stage</h3><p>Metrics come from validation.metrics. In-sample replay error is excluded. Physical temperature units are unverified; values use CSV units.</p></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Model validation table; scroll horizontally"><table><thead><tr><th>Stage</th><th>Samples</th><th>Model MAE</th><th>Baseline MAE</th><th>RMSE</th><th>Worst error</th></tr></thead><tbody>{[1,2,3,4,5,6].map(stage=>{const m=data.validation.metrics[String(stage)];return <tr key={stage}><td><span className="stage-number">0{stage}</span></td><td>{m?.n.toLocaleString()??'Not provided'}</td><td className="model-mae">{m?.mae.toFixed(5)??'—'}</td><td>{m?.baseline_mae.toFixed(5)??'—'}</td><td>{m?.rmse.toFixed(5)??'—'}</td><td>{m?.worst_error.toFixed(5)??'—'}</td></tr>})}</tbody></table></div><div className="validation-note"><Info size={17}/><p>Dataset metrics do not establish live prediction accuracy, latency or tester receipt. Full feature coverage does not imply perfect accuracy.</p></div></section></TabsContent>
 <TabsContent value="limitations"><section className="panel limitations-panel"><div className="panel-header"><h2>Evidence limitations</h2><span className="mini-label">SOURCE NOTES</span></div><div className="limitations-content"><div className="limit-callout"><TriangleAlert size={20}/><div><strong>Live acceptance is unverified</strong><p>This summary supplies no live provenance, complete event timestamps or tester receipts. A final-device alert does not prove delivery before wafer completion.</p></div></div><h3>Source limitations</h3><p>Source messages, suggestions and limitations are displayed verbatim.</p>{!data.limitations.length&&<p>No limitations supplied by this source. This does not establish acceptance.</p>}<ul>{data.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul><p className="source-status">Source live_integration: <code>{data.live_integration}</code>. This records the source file state, not the current remote status.</p><h3>Investigation scope</h3><p>The investigation console provides batch evidence, predictions and receipt status. Imports on this page are parsed in browser memory without upload or AI requests.</p></div></section></TabsContent></Tabs>
 <footer><span><FlaskConical size={13}/> {source} · Refresh restores the bundled snapshot</span><a href="/">Investigation console <ArrowUpRight size={13}/></a></footer></>}
 </main></div>;
}
function CircleIcon(){return <div className="empty-icon"><Info size={27}/></div>;}
