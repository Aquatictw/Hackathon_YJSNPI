"use client";
import {useLocale} from "@/components/locale-provider";
import { SemiconductorChat, ReferenceSources, type ResponseLanguage } from "@/components/semiconductor-chat";
import { z } from "zod";
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Database, Radio, Search, Layers3, NotebookPen, Send, RefreshCw, TriangleAlert, ChevronRight, Unplug, ClipboardList, Clock3 } from 'lucide-react';
import { createDashboardLifecycle, initialDashboardState, dashboardEvidence } from '@/lib/rtdi/ui-lifecycle';
import { predictionRows } from '@/lib/rtdi/ui-predictions';
import type { UiEdgeRecord as EdgeRecord } from '@/lib/rtdi/ui-wire';
import type { CommandStatus } from '@/lib/rtdi/command-contract';
import '../dashboard.css';
import { AppHeader } from '@/components/app-header';
import { TemperatureRecords } from '@/components/temperature-records';
import { investigationAvailability } from '@/lib/rtdi/ui-presentation';
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
 const {t, locale} = useLocale();

    const plotRef = useRef<HTMLDivElement>(null);
    const [plotWidth, setPlotWidth] = useState(650);
    useEffect(() => { const element = plotRef.current; if (!element)
        return; const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width)
        setPlotWidth(Math.max(240, width)); }); observer.observe(element); return () => observer.disconnect(); }, [e.event_id, e.series, e.site_series]);
    const site = Object.entries(e.site_series ?? {}).filter(([, v]) => v.length);
    const lines = e.kind === 'low_yield' ? [['Cumulative yield', e.series ?? []] as const] : site.length ? site : [['Observed series', e.series ?? []] as const];
    const values = lines.flatMap(([, v]) => v);
    if (!values.length)
        return <div className="dc-empty"><Activity /><h3>{t("No series available")}</h3><p>{t("The source record does not include a plottable series.")}</p></div>;
    const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi - lo) * .15, .001), min = lo - pad, max = hi + pad, count = Math.max(...lines.map(([, v]) => v.length));
    const x = (i: number) => 55 + i / Math.max(count - 1, 1) * (plotWidth - 80), y = (v: number) => 212 - (v - min) / (max - min) * 170;
    return <div className="dc-plot" ref={plotRef}><svg viewBox={"0 0 " + plotWidth + " 255"} role="img" aria-label={t("Source measurement series. The x-axis is completed-device order per site, not event time.")}>{[0, 1, 2, 3].map(i => { const v = min + (max - min) * i / 3; return <g key={i}><path d={`M55 ${y(v)}H${plotWidth - 25}`} stroke="var(--border)" strokeDasharray="3 5"/><text x="44" y={y(v) + 4} textAnchor="end">{e.kind === 'low_yield' ? `${(v * 100).toFixed(0)}%` : v.toFixed(2)}</text></g>; })}{lines.map(([label, v], j) => <path key={label} d={v.map((a, i) => `${i ? 'L' : 'M'}${x(i)} ${y(a)}`).join(' ')} stroke={palette[j % 4]} strokeWidth="2.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>)}{[0, Math.floor((count - 1) / 2), count - 1].map((i, j) => <text key={j} x={x(i)} y="240" textAnchor="middle">{i + 1}</text>)}</svg><div className="dc-legend">{lines.map(([label], i) => <span key={label}><i style={{ background: palette[i % 4] }}/>{site.length && e.kind !== 'low_yield' ? t("Site {0}", t(label)) : t(label)}</span>)}<span>{site.length && e.kind !== 'low_yield' ? t("Completed-device order per site") : t("Completed-device order")} · {e.unit ?? t("Unit unconfirmed")}</span></div></div>;
}
function Answer({ text }: {
    text: string;
}) { return <div className="dc-answer">{text.split('\n').map((line, i) => { const clean = line.replace(/^#{1,6}\s*/, ''); return line.startsWith('#') ? <h4 key={i}>{clean}</h4> : <p key={i}>{clean.split(/(\*\*.*?\*\*|`[^`]+`)/g).map((part, j) => part.startsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={j}>{part.slice(1, -1)}</code> : part)}</p>; })}</div>; }
export default function Dashboard() {
 const {t, locale} = useLocale();

    const [chatTopic, setChatTopic] = useState<"analysis" | "knowledge">("analysis");
    const {locale:language,setLocale:changeLanguage}=useLocale();    const [run, setRun] = useState('grp6-replay-demo'), [tester, setTester] = useState('grp6-replay');
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
    return <div className="dc-app"><AppHeader active="workspace"/>
 <div className="dc-main"><main id="main-content">
 <div className="dc-heading"><div><div className="dc-eyebrow">{t("OPERATIONS / RUN WORKSPACE")}</div><h1>{t("Run overview")}</h1><p>{t("Inspect source records, compare site behavior, and document findings.")}</p></div><span className="dc-stream-status" role="status" aria-live="polite"><span className={'dc-dot ' + (status === 'Event stream connected' ? 'connected' : '')}/>{t(status)}</span></div>
 <form className="dc-connect" aria-busy={status === 'Connecting'} onSubmit={e => { e.preventDefault(); void connect(); }}><div className="dc-connect-title"><Database size={18}/><div><strong>{t("Run selection")}</strong><small>{t("Run and tester scope")}</small></div></div><label>{t("Run ID")}<input value={run} onChange={e => setRun(e.target.value)} required maxLength={120}/></label><label>{t("Tester ID")}<input value={tester} onChange={e => setTester(e.target.value)} placeholder={t("Optional tester filter")} maxLength={120}/></label><button className="dc-primary" type="submit"><Radio size={16}/>{t("Load run")}</button>{scope && <button className="dc-icon" type="button" aria-label={t("Disconnect event stream")} onClick={disconnect}><Unplug size={18}/></button>}</form>
 {error && <div className="dc-error" role="alert"><TriangleAlert size={18}/>{t(error)}<span>{t("Check the run ID and backend configuration, then retry.")}</span></div>}
 <dl className="dc-stats" aria-label={t("Run summary")}>
  <div><dt>{t("Source mode")}</dt><dd>{data?.run.mode.toUpperCase() ?? '—'}</dd><small>{data?.run.tester_id ?? t("No tester loaded")}</small></div>
  <div><dt>{t("Incidents")}</dt><dd>{data?.incidents.length ?? '—'}</dd><small>{t("Source-reported")}</small></div>
  <div><dt>{t("Evidence records")}</dt><dd>{data ? evidence.length : '—'}</dd><small>{data ? t("{0} source events", data.events.length) : t("Awaiting snapshot")}</small></div>
  <div><dt>{t("Temperature predictions")}</dt><dd>{data ? predictions.length : '—'}</dd><small>{data ? t("{0} matched actuals", predictions.filter(row => row.actual !== undefined).length) : t("Awaiting snapshot")}</small></div>
 </dl>
 <div className="dc-section-heading"><h2>{t("Run records")}</h2><span className="dc-source-badge"><i />{t(source)}</span></div><div className="dc-board"><section className="dc-evidence-panel"><div className="dc-tabbar" role="tablist" aria-label={t("Run views")}>{[['evidence', 'Evidence'], ['predictions', 'Temperature'], ['commands', 'Commands']].map(([id, label]) => <button role="tab" id={`tab-${id}`} aria-controls="batch-panel" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} key={id} onKeyDown={e => { const ids = ["evidence", "predictions", "commands"]; const i = ids.indexOf(id); const next = e.key === "ArrowRight" ? ids[(i + 1) % 3] : e.key === "ArrowLeft" ? ids[(i + 2) % 3] : e.key === "Home" ? ids[0] : e.key === "End" ? ids[2] : null; if (next) {
        e.preventDefault();
        setTab(next);
        document.getElementById(`tab-${next}`)?.focus();
    } }} onClick={() => setTab(id)}>{t(label)}</button>)}</div>
 <div role="tabpanel" id="batch-panel" aria-labelledby={`tab-${tab}`}>
 {tab === 'evidence' && <><div className="dc-search"><Search size={16}/><input aria-label={t("Search evidence")} placeholder={t("Filter wafer, test, or category…")} value={search} disabled={busy} onChange={e => { lifecycle.current?.setSearch(e.target.value); }}/><span>{filtered.length} {t("records")}</span></div><div className="dc-evidence-layout"><div className="dc-event-list">{filtered.map((e, i) => <button key={e.event_id} className={current?.event_id === e.event_id ? 'selected' : ''} aria-pressed={current?.event_id === e.event_id} onClick={() => { lifecycle.current?.selectEvidence(e.event_id); }} disabled={busy}><span className="dc-event-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{t(names[e.kind ?? ''] ?? e.kind) ?? t("Evidence")}</strong><small>W{e.wafer_id ?? '—'} · {e.site_id ? t("Site {0}", e.site_id) : t("All sites")}</small></div><ChevronRight size={14}/></button>)}{!filtered.length && <p className="dc-list-empty">{data ? t("No matching records") : t("Load a run to view records")}</p>}</div><div className="dc-detail">{current ? <><div className="dc-detail-top"><span className="dc-warning">{current.severity ?? t("evidence")}</span><span>{t("WAFER")}{current.wafer_id ?? '—'}</span></div><h3>{t(names[current.kind ?? ''] ?? current.kind) ?? t("Evidence")}</h3><p className="dc-message">{current.message ?? t("No source description provided")}</p><div className="dc-values"><div><small>{t("Observed")}</small><strong>{observation(current, current.current_value)}</strong></div><div><small>{t("Baseline")}</small><strong>{observation(current, current.baseline)}</strong></div><div><small>{t("Score · not probability")}</small><strong>{number(current.score)}</strong></div></div><p className="dc-message">{t("Source threshold:")}{number(current.threshold)} {t("· threshold scale unconfirmed")}</p><div className="dc-chart-title"><h4>{t("Measurement series")}</h4><span>{t("Source observations")}</span></div><Plot e={current}/><div className="dc-suggestion"><ClipboardList size={17}/><div><strong>{t("Suggested checks")}<small>{t("Source recommendation")}</small></strong><p>{current.suggestion ?? t("No source recommendation provided")}</p></div></div><p className="dc-message">{t("Response:")}{t(predictionLabels[current.response_status ?? 'unknown'])} {t("· Receipt:")}{current.tester_receipt_id ?? t("Not provided")}</p><details className="dc-raw"><summary>{t("Record identity & raw JSON")}</summary><pre>{JSON.stringify(current, null, 2)}</pre></details></> : <div className="dc-empty"><div className="dc-empty-symbol"><Layers3 size={36}/></div><h3>{data ? t("No evidence in this scope") : t("No run loaded")}</h3><p>{data ? t("No reported alert does not establish normal operation.") : t("Load a run using the controls above. Replay analysis is available separately.")}</p><a href="/">{t("Open replay analysis")}<ArrowRight size={16}/></a></div>}</div></div></>}
 {tab === 'predictions' && <TemperatureRecords predictions={predictions}/>}
 {tab === 'commands' && <div className="dc-command-list"><p>{t("Read-only backend status. Investigation responses do not change commands.")}</p>{data?.commands.map(c => <article key={c.command_id}><span>{t(commandLabels[c.status]) ?? c.status}</span><h3>{c.message}</h3><small>{c.command_id}</small><p>{c.tester_receipt_id ? t("Receipt reference: {0}", c.tester_receipt_id) : t("No receipt reference in this snapshot. Tester receipt cannot be independently verified here.")}</p></article>)}{!data?.commands.length && <div className="dc-empty"><Unplug /><h3>{t("No commands recorded")}</h3><p>{t("This workspace does not send tester commands automatically.")}</p></div>}</div>}
 </div></section><aside className="dc-ai" aria-labelledby="investigation-heading"><div className="dc-ai-heading"><NotebookPen size={18}/><div><h2 id="investigation-heading">{t("Semiconductor assistant")}</h2><small>{t("Local references · Evidence-linked analysis")}</small></div><span className="dc-readonly">{t("Read only")}</span></div>
 <div className="dc-assistant-controls"><div className="dc-assistant-modes" role="group" aria-label={t("Assistant topic")}>
 <button type="button" aria-pressed={chatTopic === 'analysis'} onClick={() => setChatTopic('analysis')}>{t("Selected analysis")}</button>
 <button type="button" aria-pressed={chatTopic === 'knowledge'} onClick={() => setChatTopic('knowledge')}>{t("Semiconductor Q&A")}</button></div>
 <label htmlFor="response-language">{t("Response language")}<select id="response-language" value={language} onChange={event => changeLanguage(event.target.value as ResponseLanguage)}><option value="en">{t("English")}</option><option value="zh-TW">繁體中文</option></select></label>
 <small>{t("Applies to the next submitted question.")}</small></div>
 <div hidden={chatTopic !== 'knowledge'}>
 {(!config?.openai_configured || configError) && <div className="dc-service-state" role="status"><strong>{configError ? t("Service check failed") : !config ? t("Checking service") : t("Model service unavailable")}</strong><p>{t("General questions need the model service, but do not need a loaded run.")}</p><button className="dc-secondary" onClick={() => setConfigAttempt(n => n + 1)}>{t("Retry service check")}</button></div>}
 <SemiconductorChat enabled={Boolean(config?.openai_configured) && !configError} language={language}/></div>
 <div hidden={chatTopic !== 'analysis'}><div className="dc-ai-context"><span>{t("Context")}</span><strong>{current ? t("W{0} · Site {1} · {2}", current.wafer_id ?? '—', current.site_id ?? t("All"), t(names[current.kind ?? ''] ?? current.kind)) : scope?.run ?? t("No run selected")}</strong></div>{!ai.enabled && <div className="dc-service-state" role="status"><strong>{t(ai.title)}</strong><p>{t(ai.message)}</p><div><button type="button" className="dc-secondary" onClick={() => setConfigAttempt(n => n + 1)}>{t("Retry service check")}</button><a href="/sandbox">{t("Open sandbox")}</a></div></div>}<div className="dc-chat" aria-live="polite">{!messages.length ? <div className="dc-ai-welcome"><span className="dc-notebook-label">{t("NEW INVESTIGATION")}</span><h3>{t("No entries for this context")}</h3><p>{t("Select an evidence record and draft a question. Answers use local method notes and verified records from the loaded run. Use Semiconductor Q&A for general concepts.")}</p><div className="dc-draft-label">{t("Question templates")}<span>{t("Draft only")}</span></div>{['Summarize the evidence for this anomaly.', 'Compare the affected sites and identify differences.', 'What additional measurements would test this finding?'].map(q => <button key={q} disabled={!scope || busy || !ai.enabled} onClick={() => { lifecycle.current?.setQuestion(t(q)); document.getElementById('investigation-question')?.focus(); }}>{t(q)}<ArrowRight size={14}/></button>)}</div> : messages.map((m, i) => <div key={i} className={`dc-chat-message ${m.role}`}><small>{m.role === 'user' ? t("QUESTION") : t("ANALYSIS")}</small><Answer text={m.text}/><ReferenceSources ids={m.knowledgeRefs}/>{m.refs?.length ? <div className="dc-citations">{m.refs.map(id => { const sourceRecord = data?.events.find(record => record.event_id === id); if (sourceRecord && !evidence.some(record => record.evidence_id === id)) return <details key={id} className="dc-local-sources"><summary>{t("Source record ·")}{id}</summary><pre className="dc-raw">{JSON.stringify(sourceRecord, null, 2)}</pre></details>; return <button key={id} disabled={!evidence.some(record => record.evidence_id === id)} title={evidence.some(record => record.evidence_id === id) ? t("Open cited evidence") : t("Cited evidence is not in the current snapshot")} onClick={() => { const e = evidence.find(e => e.evidence_id === id); if (e) {
        lifecycle.current?.selectEvidence(e.event_id, true);
        setTab('evidence');
    } }}>↗ {id}</button>; })}</div> : null}{m.id && <small>{t("Investigation ID")}{m.id}</small>}</div>)}{busy && <div className="dc-thinking"><RefreshCw size={15}/>{t("Retrieving evidence and preparing response…")}</div>}</div>{chatError && <div className="dc-error" role="alert">{t(chatError)}</div>}<form className="dc-composer" onSubmit={e => { e.preventDefault(); void ask(question); }}><textarea id="investigation-question" aria-label={t("Investigation question")} aria-describedby="ai-service-note" placeholder={!ai.enabled ? t(ai.title) : scope ? t("Ask a question about this run…") : t("Load a run to start an investigation…")} value={question} onChange={e => lifecycle.current?.setQuestion(e.target.value)} maxLength={2000} disabled={!scope || busy || !ai.enabled}/><div><span>{t("One request per submission")}</span><button className="dc-primary" aria-label={t("Submit question")} disabled={!scope || busy || !ai.enabled || !question.trim()}><Send size={15}/>{t("Submit")}</button></div></form><p id="ai-service-note" className="dc-ai-foot">{t("Local references, no web search. Analysis is advisory and does not confirm tester receipt.")}</p></div></aside></div>
 <footer className="dc-footer"><span><Database size={13}/>{data ? `${data.run.run_id} / ${data.run.tester_id}` : t("No backend snapshot")}{data?.run.mode === 'replay' ? t(" · Replay timestamps represent import ordering") : ''}{data && t(" · Last source event: {0} · Stored data does not establish current tester connectivity", data.run.last_event_at)}</span><span>RTDI / GRP6</span></footer></main></div></div>;
}
