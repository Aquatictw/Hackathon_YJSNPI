"use client";
import { SemiconductorChat, ReferenceSources, type ResponseLanguage } from "@/components/semiconductor-chat";
import { z } from "zod";
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Database, Radio, FlaskConical, Search, Layers3, NotebookPen, Send, RefreshCw, TriangleAlert, ChevronRight, Unplug, ClipboardList, Clock3 } from 'lucide-react';
import { createDashboardLifecycle, initialDashboardState, dashboardEvidence } from '@/lib/rtdi/ui-lifecycle';
import { predictionRows } from '@/lib/rtdi/ui-predictions';
import type { UiEdgeRecord as EdgeRecord } from '@/lib/rtdi/ui-wire';
import type { CommandStatus } from '@/lib/rtdi/command-contract';
import './dashboard.css';
import { ThemeSelector } from '@/components/theme-controls';
import { displayNumber, investigationAvailability } from '@/lib/rtdi/ui-presentation';
const names: Record<string, string> = { site_imbalance: 'Site imbalance', low_yield: 'Low yield', mean_drift_up: 'Mean drift · up', mean_drift_down: 'Mean drift · down', spread_up: 'Spread increase', spread_down: 'Spread decrease' };
const predictionLabels: Record<NonNullable<EdgeRecord['response_status']>, string> = { not_requested: 'Not requested', insufficient_data: 'Insufficient data', response_queued: 'Response queued · tester unconfirmed', tester_confirmed: 'Source reports tester confirmation', unknown: 'Unknown' };
const commandLabels: Record<CommandStatus, string> = {
    queued: 'Queued at backend',
    received: 'Edge received · tester unconfirmed',
    queued_to_tester: 'Queued to tester · tester unconfirmed',
    tester_confirmed: 'Backend reports tester confirmation',
    rejected: 'Rejected',
    failed: 'Processing failed',
    expired: 'Expired',
};
const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const number = (n: number | undefined) => n === undefined ? '—' : n.toFixed(4);
const observation = (e: EdgeRecord, n: number | undefined) => n === undefined ? '—' : e.kind === 'low_yield' ? `${(n * 100).toFixed(2)}%` : number(n);
function Plot({ e }: {
    e: EdgeRecord;
}) {
    const plotRef = useRef<HTMLDivElement>(null);
    const [plotWidth, setPlotWidth] = useState(650);
    useEffect(() => { const element = plotRef.current; if (!element)
        return; const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width)
        setPlotWidth(Math.max(240, width)); }); observer.observe(element); return () => observer.disconnect(); }, [e.event_id, e.series, e.site_series]);
    const site = Object.entries(e.site_series ?? {}).filter(([, v]) => v.length);
    const lines = e.kind === 'low_yield' ? [['Cumulative yield', e.series ?? []] as const] : site.length ? site : [['Observed series', e.series ?? []] as const];
    const values = lines.flatMap(([, v]) => v);
    if (!values.length)
        return <div className="dc-empty"><Activity /><h3>No series available</h3><p>The source record does not include a plottable series.</p></div>;
    const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi - lo) * .15, .001), min = lo - pad, max = hi + pad, count = Math.max(...lines.map(([, v]) => v.length));
    const x = (i: number) => 55 + i / Math.max(count - 1, 1) * (plotWidth - 80), y = (v: number) => 212 - (v - min) / (max - min) * 170;
    return <div className="dc-plot" ref={plotRef}><svg viewBox={"0 0 " + plotWidth + " 255"} role="img" aria-label="Source measurement series. The x-axis is completed-device order per site, not event time.">{[0, 1, 2, 3].map(i => { const v = min + (max - min) * i / 3; return <g key={i}><path d={`M55 ${y(v)}H${plotWidth - 25}`} stroke="var(--border)" strokeDasharray="3 5"/><text x="44" y={y(v) + 4} textAnchor="end">{e.kind === 'low_yield' ? `${(v * 100).toFixed(0)}%` : v.toFixed(2)}</text></g>; })}{lines.map(([label, v], j) => <path key={label} d={v.map((a, i) => `${i ? 'L' : 'M'}${x(i)} ${y(a)}`).join(' ')} stroke={palette[j % 4]} strokeWidth="2.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>)}{[0, Math.floor((count - 1) / 2), count - 1].map((i, j) => <text key={j} x={x(i)} y="240" textAnchor="middle">{i + 1}</text>)}</svg><div className="dc-legend">{lines.map(([label], i) => <span key={label}><i style={{ background: palette[i % 4] }}/>{site.length && e.kind !== 'low_yield' ? `Site ${label}` : label}</span>)}<span>{site.length && e.kind !== 'low_yield' ? 'Completed-device order per site' : 'Completed-device order'} · {e.unit ?? 'Unit unconfirmed'}</span></div></div>;
}
function Answer({ text }: {
    text: string;
}) { return <div className="dc-answer">{text.split('\n').map((line, i) => { const clean = line.replace(/^#{1,6}\s*/, ''); return line.startsWith('#') ? <h4 key={i}>{clean}</h4> : <p key={i}>{clean.split(/(\*\*.*?\*\*|`[^`]+`)/g).map((part, j) => part.startsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={j}>{part.slice(1, -1)}</code> : part)}</p>; })}</div>; }
export default function Dashboard() {
    const [chatTopic, setChatTopic] = useState<"analysis" | "knowledge">("analysis");
    const [language, setLanguage] = useState<ResponseLanguage>("en");
    useEffect(() => { try { const saved = localStorage.getItem("rtdi.response-language"); if (saved === "en" || saved === "zh-TW") setLanguage(saved); } catch {} }, []);
    const changeLanguage = (value: ResponseLanguage) => { setLanguage(value); try { localStorage.setItem("rtdi.response-language", value); } catch {} };
    const [run, setRun] = useState('grp6-replay-demo'), [tester, setTester] = useState('grp6-replay');
    const [state, setState] = useState(initialDashboardState), [tab, setTab] = useState('evidence');
    const { scope, data, status, error, search, question, busy, chatError, messages } = state;
    const [config, setConfig] = useState<{
        openai_configured: boolean;
        backend_connected: boolean;
    } | null>(null);
    const [configError, setConfigError] = useState(false), [configAttempt, setConfigAttempt] = useState(0);
    const ai = investigationAvailability(config, configError);
    const lifecycle = useRef<ReturnType<typeof createDashboardLifecycle> | null>(null);
    useEffect(() => {
        const controller = createDashboardLifecycle({ fetch: (...args) => fetch(...args), eventSource: url => new EventSource(url) }, setState, { conversationStorage: { getItem: key => window.sessionStorage.getItem(key), setItem: (key, value) => window.sessionStorage.setItem(key, value) } });
        lifecycle.current = controller;
        void controller.restoreSession();
        return () => { controller.dispose(); lifecycle.current = null; };
    }, []);
    useEffect(() => {
        const ctrl = new AbortController();
        let active = true;
        setConfigError(false);
        setConfig(null);
        fetch('/api/config', { signal: ctrl.signal, cache: 'no-store' }).then(r => { if (!r.ok)
            throw Error('Configuration unavailable'); return r.json(); }).then(value => { if (active)
            setConfig(z.object({ openai_configured: z.boolean(), backend_connected: z.boolean() }).parse(value)); }).catch(() => { if (active)
            setConfigError(true); });
        return () => { active = false; ctrl.abort(); };
    }, [configAttempt]);
    useEffect(() => { if (scope) {
        setRun(scope.run);
        setTester(scope.tester);
    } }, [scope?.run, scope?.tester]);
    const connect = () => lifecycle.current?.connect(run, tester);
    const disconnect = () => lifecycle.current?.disconnect();
    const ask = (q: string) => { if (ai.enabled)
        return lifecycle.current?.ask(q, language); };
    const { evidence, filtered, current } = dashboardEvidence(state);
    const predictions = predictionRows(data?.events ?? []);
    const source = data?.run.mode === 'live' ? 'LIVE · SOURCE-REPORTED' : data?.run.mode === 'replay' ? 'REPLAY · IMPORTED RECORDS' : data ? 'SIMULATION' : 'NO RUN LOADED';
    return <div className="dc-app"><a className="dc-skip" href="#main-content">Skip to main content</a>
 <header className="dc-top">
  <a className="dc-brand" href="/" aria-label="RTDI test analysis home"><Activity size={23}/><strong>RTDI</strong><span>TEST ANALYSIS</span></a>
  <nav className="dc-nav" aria-label="Main navigation"><a href="/" aria-current="page"><Layers3 size={16}/>Run workspace</a><a href="/replay"><Activity size={16}/>Replay analysis</a><a href="/sandbox"><FlaskConical size={16}/>Sandbox</a></nav>
  <div className="dc-top-tools"><ThemeSelector /><span className="dc-team">GRP6</span></div>
 </header>
 <div className="dc-main"><main id="main-content">
 <div className="dc-heading"><div><div className="dc-eyebrow">OPERATIONS / RUN WORKSPACE</div><h1>Run overview</h1><p>Inspect source records, compare site behavior, and document findings.</p></div><span className="dc-stream-status" role="status" aria-live="polite"><span className={'dc-dot ' + (status === 'Event stream connected' ? 'connected' : '')}/>{status}</span></div>
 <form className="dc-connect" aria-busy={status === 'Connecting'} onSubmit={e => { e.preventDefault(); void connect(); }}><div className="dc-connect-title"><Database size={18}/><div><strong>Run selection</strong><small>Run and tester scope</small></div></div><label>Run ID<input value={run} onChange={e => setRun(e.target.value)} required maxLength={120}/></label><label>Tester ID<input value={tester} onChange={e => setTester(e.target.value)} placeholder="Optional tester filter" maxLength={120}/></label><button className="dc-primary" type="submit"><Radio size={16}/>Load run</button>{scope && <button className="dc-icon" type="button" aria-label="Disconnect event stream" onClick={disconnect}><Unplug size={18}/></button>}</form>
 {error && <div className="dc-error" role="alert"><TriangleAlert size={18}/>{error}<span>Check the run ID and backend configuration, then retry.</span></div>}
 <dl className="dc-stats" aria-label="Run summary">
  <div><dt>Source mode</dt><dd>{data?.run.mode.toUpperCase() ?? '—'}</dd><small>{data?.run.tester_id ?? 'No tester loaded'}</small></div>
  <div><dt>Incidents</dt><dd>{data?.incidents.length ?? '—'}</dd><small>Source-reported</small></div>
  <div><dt>Evidence records</dt><dd>{data ? evidence.length : '—'}</dd><small>{data ? data.events.length + ' source events' : 'Awaiting snapshot'}</small></div>
  <div><dt>Predictions</dt><dd>{data ? predictions.length : '—'}</dd><small>{data ? predictions.filter(row => row.actual !== undefined).length + ' matched actuals' : 'Awaiting snapshot'}</small></div>
 </dl>
 <div className="dc-section-heading"><h2>Run records</h2><span className="dc-source-badge"><i />{source}</span></div><div className="dc-board"><section className="dc-evidence-panel"><div className="dc-tabbar" role="tablist" aria-label="Run views">{[['evidence', 'Evidence'], ['predictions', 'Predictions'], ['commands', 'Commands']].map(([id, label]) => <button role="tab" id={`tab-${id}`} aria-controls="batch-panel" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} key={id} onKeyDown={e => { const ids = ["evidence", "predictions", "commands"]; const i = ids.indexOf(id); const next = e.key === "ArrowRight" ? ids[(i + 1) % 3] : e.key === "ArrowLeft" ? ids[(i + 2) % 3] : e.key === "Home" ? ids[0] : e.key === "End" ? ids[2] : null; if (next) {
        e.preventDefault();
        setTab(next);
        document.getElementById(`tab-${next}`)?.focus();
    } }} onClick={() => setTab(id)}>{label}</button>)}</div>
 <div role="tabpanel" id="batch-panel" aria-labelledby={`tab-${tab}`}>
 {tab === 'evidence' && <><div className="dc-search"><Search size={16}/><input aria-label="Search evidence" placeholder="Filter wafer, test, or category…" value={search} disabled={busy} onChange={e => { lifecycle.current?.setSearch(e.target.value); }}/><span>{filtered.length} records</span></div><div className="dc-evidence-layout"><div className="dc-event-list">{filtered.map((e, i) => <button key={e.event_id} className={current?.event_id === e.event_id ? 'selected' : ''} aria-pressed={current?.event_id === e.event_id} onClick={() => { lifecycle.current?.selectEvidence(e.event_id); }} disabled={busy}><span className="dc-event-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{names[e.kind ?? ''] ?? e.kind ?? 'Evidence'}</strong><small>W{e.wafer_id ?? '—'} · {e.site_id ? `Site ${e.site_id}` : 'All sites'}</small></div><ChevronRight size={14}/></button>)}{!filtered.length && <p className="dc-list-empty">{data ? 'No matching records' : 'Load a run to view records'}</p>}</div><div className="dc-detail">{current ? <><div className="dc-detail-top"><span className="dc-warning">{current.severity ?? 'evidence'}</span><span>WAFER {current.wafer_id ?? '—'}</span></div><h3>{names[current.kind ?? ''] ?? current.kind ?? 'Evidence'}</h3><p className="dc-message">{current.message ?? 'No source description provided'}</p><div className="dc-values"><div><small>Observed</small><strong>{observation(current, current.current_value)}</strong></div><div><small>Baseline</small><strong>{observation(current, current.baseline)}</strong></div><div><small>Score · not probability</small><strong>{number(current.score)}</strong></div></div><p className="dc-message">Source threshold: {number(current.threshold)} · threshold scale unconfirmed</p><div className="dc-chart-title"><h4>Measurement series</h4><span>Source observations</span></div><Plot e={current}/><div className="dc-suggestion"><ClipboardList size={17}/><div><strong>Suggested checks <small>Source recommendation</small></strong><p>{current.suggestion ?? 'No source recommendation provided'}</p></div></div><p className="dc-message">Response: {predictionLabels[current.response_status ?? 'unknown']} · Receipt: {current.tester_receipt_id ?? 'Not provided'}</p><details className="dc-raw"><summary>Record identity & raw JSON</summary><pre>{JSON.stringify(current, null, 2)}</pre></details></> : <div className="dc-empty"><div className="dc-empty-symbol"><Layers3 size={36}/></div><h3>{data ? 'No evidence in this scope' : 'No run loaded'}</h3><p>{data ? 'No reported alert does not establish normal operation.' : 'Load a run using the controls above. Replay analysis is available separately.'}</p><a href="/replay">Open replay analysis <ArrowRight size={16}/></a></div>}</div></div></>}
 {tab === 'predictions' && <div className="dc-table-wrap" tabIndex={0} role="region" aria-label="Prediction records, horizontally scrollable"><p>Source predictions with uniquely matched actuals. Feature coverage is not accuracy.</p><table><thead><tr><th>Stage / Device</th><th>Site</th><th>Predicted / Actual</th><th>Unit</th><th>Feature coverage</th><th>Response / Receipt</th></tr></thead><tbody>{predictions.map(e => <tr key={e.event_id}><td>{e.stage}<small>{e.device_id}</small><details><summary>Prediction provenance</summary><small>Site request: {e.request_id ?? 'Not provided'}</small><small>Original request: {e.original_request_id ?? 'Not provided'}</small><small>Source event: {e.source_event_id ?? 'Not provided'}</small><small>Exact prediction: {e.prediction ?? 'Not provided'}</small><small>Exact actual: {e.actual ?? 'Not provided'}</small></details></td><td>{e.site_id ?? '—'}</td><td><span title={`Exact prediction: ${e.prediction ?? 'Not provided'}；Exact actual: ${e.actual ?? 'Not provided'}`}>{e.prediction === undefined ? '—' : displayNumber(e.prediction)} / {e.actual === undefined ? '—' : displayNumber(e.actual)}</span>{e.actual_status && <small>{e.actual_status === '實測衝突' ? 'Conflicting actuals' : 'Ambiguous actual scope'}</small>}</td><td>{e.unit ?? 'Unconfirmed'}</td><td>{e.coverage === undefined ? 'Not provided' : `${(e.coverage * 100).toFixed(0)}%`}</td><td>{predictionLabels[e.response_status ?? 'unknown']}<small>{e.tester_receipt_id ?? 'No receipt provided'}</small></td></tr>)}</tbody></table>{!predictions.length && <div className="dc-empty"><Clock3 /><h3>No prediction records</h3></div>}</div>}
 {tab === 'commands' && <div className="dc-command-list"><p>Read-only backend status. Investigation responses do not change commands.</p>{data?.commands.map(c => <article key={c.command_id}><span>{commandLabels[c.status] ?? c.status}</span><h3>{c.message}</h3><small>{c.command_id}</small><p>{c.tester_receipt_id ? `Receipt reference: ${c.tester_receipt_id}` : 'No receipt reference in this snapshot. Tester receipt cannot be independently verified here.'}</p></article>)}{!data?.commands.length && <div className="dc-empty"><Unplug /><h3>No commands recorded</h3><p>This workspace does not send tester commands automatically.</p></div>}</div>}
 </div></section><aside className="dc-ai" aria-labelledby="investigation-heading"><div className="dc-ai-heading"><NotebookPen size={18}/><div><h2 id="investigation-heading">Semiconductor assistant</h2><small>Local references · Evidence-linked analysis</small></div><span className="dc-readonly">Read only</span></div>
 <div className="dc-assistant-controls"><div className="dc-assistant-modes" role="group" aria-label="Assistant topic">
 <button type="button" aria-pressed={chatTopic === 'analysis'} onClick={() => setChatTopic('analysis')}>Selected analysis</button>
 <button type="button" aria-pressed={chatTopic === 'knowledge'} onClick={() => setChatTopic('knowledge')}>Semiconductor Q&amp;A</button></div>
 <label htmlFor="response-language">Response language<select id="response-language" value={language} onChange={event => changeLanguage(event.target.value as ResponseLanguage)}><option value="en">English</option><option value="zh-TW">繁體中文</option></select></label>
 <small>Applies to the next submitted question.</small></div>
 <div hidden={chatTopic !== 'knowledge'}>
 {(!config?.openai_configured || configError) && <div className="dc-service-state" role="status"><strong>{configError ? 'Service check failed' : !config ? 'Checking service' : 'Model service unavailable'}</strong><p>General questions need the model service, but do not need a loaded run.</p><button className="dc-secondary" onClick={() => setConfigAttempt(n => n + 1)}>Retry service check</button></div>}
 <SemiconductorChat enabled={Boolean(config?.openai_configured) && !configError} language={language}/></div>
 <div hidden={chatTopic !== 'analysis'}><div className="dc-ai-context"><span>Context</span><strong>{current ? `W${current.wafer_id ?? '—'} · Site ${current.site_id ?? 'All'} · ${names[current.kind ?? ''] ?? current.kind}` : scope?.run ?? 'No run selected'}</strong></div><div className={"dc-service-state " + (ai.enabled ? "available" : "")} role="status"><strong>{ai.title}</strong><p>{ai.message}</p>{!ai.enabled && <div><button type="button" className="dc-secondary" onClick={() => setConfigAttempt(n => n + 1)}>Retry service check</button><a href="/sandbox">Open sandbox</a></div>}</div><div className="dc-chat" aria-live="polite">{!messages.length ? <div className="dc-ai-welcome"><span className="dc-notebook-label">NEW INVESTIGATION</span><h3>No entries for this context</h3><p>Select an evidence record and draft a question. Answers use local method notes and verified records from the loaded run. Use Semiconductor Q&A for general concepts.</p><div className="dc-draft-label">Question templates <span>Draft only</span></div>{['Summarize the evidence for this anomaly.', 'Compare the affected sites and identify differences.', 'What additional measurements would test this finding?'].map(q => <button key={q} disabled={!scope || busy || !ai.enabled} onClick={() => { lifecycle.current?.setQuestion(q); document.getElementById('investigation-question')?.focus(); }}>{q}<ArrowRight size={14}/></button>)}</div> : messages.map((m, i) => <div key={i} className={`dc-chat-message ${m.role}`}><small>{m.role === 'user' ? 'QUESTION' : 'ANALYSIS'}</small><Answer text={m.text}/><ReferenceSources ids={m.knowledgeRefs}/>{m.refs?.length ? <div className="dc-citations">{m.refs.map(id => { const sourceRecord = data?.events.find(record => record.event_id === id); if (sourceRecord && !evidence.some(record => record.evidence_id === id)) return <details key={id} className="dc-local-sources"><summary>Source record · {id}</summary><pre className="dc-raw">{JSON.stringify(sourceRecord, null, 2)}</pre></details>; return <button key={id} disabled={!evidence.some(record => record.evidence_id === id)} title={evidence.some(record => record.evidence_id === id) ? "Open cited evidence" : "Cited evidence is not in the current snapshot"} onClick={() => { const e = evidence.find(e => e.evidence_id === id); if (e) {
        lifecycle.current?.selectEvidence(e.event_id, true);
        setTab('evidence');
    } }}>↗ {id}</button>; })}</div> : null}{m.id && <small>Investigation ID {m.id}</small>}</div>)}{busy && <div className="dc-thinking"><RefreshCw size={15}/>Retrieving evidence and preparing response…</div>}</div>{chatError && <div className="dc-error" role="alert">{chatError}</div>}<form className="dc-composer" onSubmit={e => { e.preventDefault(); void ask(question); }}><textarea id="investigation-question" aria-label="Investigation question" aria-describedby="ai-service-note" placeholder={!ai.enabled ? ai.title : scope ? 'Ask a question about this run…' : 'Load a run to start an investigation…'} value={question} onChange={e => lifecycle.current?.setQuestion(e.target.value)} maxLength={2000} disabled={!scope || busy || !ai.enabled}/><div><span>One request per submission</span><button className="dc-primary" aria-label="Submit question" disabled={!scope || busy || !ai.enabled || !question.trim()}><Send size={15}/>Submit</button></div></form><p id="ai-service-note" className="dc-ai-foot">Local references, no web search. Analysis is advisory and does not confirm tester receipt.</p></div></aside></div>
 <footer className="dc-footer"><span><Database size={13}/>{data ? `${data.run.run_id} / ${data.run.tester_id}` : 'No backend snapshot'}{data?.run.mode === 'replay' ? ' · Replay timestamps represent import ordering' : ''}{data && ` · Last source event: ${data.run.last_event_at} · Stored data does not establish current tester connectivity`}</span><span>RTDI / GRP6</span></footer></main></div></div>;
}
