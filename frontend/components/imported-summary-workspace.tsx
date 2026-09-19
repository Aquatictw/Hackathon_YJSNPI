"use client";

import { useState } from 'react';
import { FileJson2, TriangleAlert } from 'lucide-react';
import { StoredRunPicker } from '@/components/stored-run-picker';
import { AppHeader } from '@/components/app-header';
import { useLocale } from '@/components/locale-provider';
import { alertNames, formatObservation, replayChart, replayTotals, waferState, type ReplayAlert } from '@/lib/rtdi/replay';
import { updateReplaySelection, type ReplaySelection, type SourceSession } from '@/lib/rtdi/source-session';
import './imported-summary-workspace.css';

type ImportedReplay = NonNullable<SourceSession['replay']>;
const tabs = [['analysis', 'Wafers & alerts'], ['validation', 'Model validation'], ['limitations', 'Limitations']] as const;
const unavailableSections = [
    ['Temperature', 'This summary contains validation metrics, not individual prediction/actual records. Load a backend run to inspect temperature records.'],
    ['Commands', 'This summary contains no backend commands or tester receipts. Load a backend run to inspect recorded command status.'],
    ['Selected analysis', 'Imported summary evidence is not sent to the model. Load a backend run to investigate verified backend records.'],
] as const;
const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

function normalizeSelection(replay: ImportedReplay): ReplaySelection {
    const saved = replay.selection;
    const filter = ['all', 'alert', 'quiet'].includes(saved.filter) ? saved.filter : 'all';
    const visible = replay.data.wafers.filter(wafer => filter === 'all' || waferState(wafer) === filter);
    const wafer = visible.find(wafer => wafer.wafer === saved.waferId) ?? visible[0];
    return { ...saved, filter, waferId: wafer?.wafer ?? '',
        alertIndex: wafer?.wafer === saved.waferId && wafer.alerts[saved.alertIndex] ? saved.alertIndex : 0,
        tab: tabs.some(([id]) => id === saved.tab) ? saved.tab : 'analysis' };
}

function SourceJson({ label, value }: { label: string; value: unknown }) {
    const [open, setOpen] = useState(false);
    return <details className="dc-raw" onToggle={event => setOpen(event.currentTarget.open)}><summary>{label}</summary>{open && <pre>{JSON.stringify(value, null, 2)}</pre>}</details>;
}

function SummaryPlot({ alert }: { alert: ReplayAlert }) {
    const { t } = useLocale();
    const lines = replayChart(alert);
    const values = lines.flatMap(line => line.values);
    if (!values.length) return <p className="isw-note">{t('No sequence supplied. A chart is unavailable.')}</p>;
    const yieldMode = alert.kind === 'low_yield';
    const low = values.reduce((min, value) => Math.min(min, value), Infinity);
    const high = values.reduce((max, value) => Math.max(max, value), -Infinity);
    // Scale first so even finite extreme source values cannot overflow the SVG range.
    const scale = Math.max(Math.abs(low), Math.abs(high), 1);
    const bottom = yieldMode ? Math.min(0, low / scale) : low / scale;
    const top = yieldMode ? Math.max(1 / scale, high / scale) : high / scale;
    const pad = Math.max((top - bottom) * .12, .0001 / scale);
    const min = bottom - pad, max = top + pad;
    const count = Math.max(...lines.map(line => line.values.length));
    const x = (index: number) => 80 + index / Math.max(count - 1, 1) * 540;
    const y = (value: number) => 210 - (value / scale - min) / (max - min) * 175;
    const label = (name: string) => name.startsWith('Site ') ? t('Site {0}', name.slice(5)) : t(name);
    return <div className="isw-plot"><div className="isw-plot-scroll" role="region" tabIndex={0} aria-label={t('Measurement series')}><svg viewBox="0 0 650 250" role="img" aria-label={t('{0}; {1}; x-axis is sample order, not time.', t(alertNames[alert.kind]), lines.map(line => label(line.name)).join(', '))}>
        {[0, 1, 2, 3].map(index => {
            const ratio = index / 3, v = (min + (max - min) * ratio) * scale;
            return <g key={index}><path d={`M80 ${210 - ratio * 175}H620`} stroke="var(--border)"/><text x="70" y={214 - ratio * 175} textAnchor="end">{yieldMode ? `${(v * 100).toFixed(0)}%` : v.toPrecision(3)}</text></g>;
        })}
        {lines.map((line, index) => <g key={line.name}><path d={line.values.map((value, i) => `${i ? 'L' : 'M'}${x(i)} ${y(value)}`).join(' ')} fill="none" stroke={colors[index % colors.length]} strokeWidth="2.5"/>{line.values.length === 1 && <circle cx={x(0)} cy={y(line.values[0])} r="4" fill={colors[index % colors.length]}/>}</g>)}
        {[0, Math.floor((count - 1) / 2), count - 1].map((index, key) => <text key={key} x={x(index)} y="240" textAnchor="middle">{index + 1}</text>)}
    </svg></div><div className="dc-legend">{lines.map((line, index) => <span key={line.name}><i style={{ background: colors[index % colors.length] }}/>{label(line.name)}</span>)}</div><p className="isw-note">{yieldMode ? t('Completed-device order') : t('Sample order within each site')} {t('· no timestamps')} · {yieldMode ? t('Percent') : t('Raw values · units unverified')}</p></div>;
}

export function ImportedSummaryWorkspace({ replay, onLoadBackend }: { replay: ImportedReplay; onLoadBackend: (run: string, tester: string) => void }) {
    const { t } = useLocale();
    const { data, filename } = replay;
    const [selection, setSelection] = useState(() => normalizeSelection(replay));
    const [selectionError, setSelectionError] = useState(false);
    const [backendError, setBackendError] = useState(false);
    const total = replayTotals(data);
    const visible = data.wafers.filter(wafer => selection.filter === 'all' || waferState(wafer) === selection.filter);
    const wafer = data.wafers.find(wafer => wafer.wafer === selection.waferId);
    const alert = wafer?.alerts[selection.alertIndex];
    function select(change: Partial<ReplaySelection>) {
        const next = { ...selection, ...change };
        setSelection(next);
        try { updateReplaySelection(next); setSelectionError(false); }
        catch { setSelectionError(true); }
    }
    function filterWafers(filter: string) {
        const matching = data.wafers.filter(item => filter === 'all' || waferState(item) === filter);
        const next = matching.find(item => item.wafer === selection.waferId) ?? matching[0];
        select({ filter, waferId: next?.wafer ?? '', ...(next?.wafer !== selection.waferId ? { alertIndex: 0, detailOpen: true } : {}) });
    }
    return <div className="dc-app isw-app"><AppHeader active="workspace"/><div className="dc-main"><main id="main-content">
        <div className="dc-heading"><div><div className="dc-eyebrow">{t('OPERATIONS / RUN WORKSPACE')}</div><h1>{t('Imported summary')}</h1><p>{t('Inspect recorded alerts, site measurements and model validation.')}</p></div><span className="dc-source-badge">{t('OFFLINE EVIDENCE')}</span></div>
        <div className="isw-source" data-tour-local-import="true"><FileJson2 size={20}/><strong>{filename}</strong><a href="/">{t('Open replay analysis')}</a></div>
        <p className="isw-note">{t('Summary source only. No backend run, event stream or model request is started.')}</p>
        <StoredRunPicker imported onLoad={(run, tester) => {
            setBackendError(false);
            try { onLoadBackend(run, tester); } catch { setBackendError(true); }
        }}/>
        {backendError && <p className="dc-error" role="alert">{t('Could not save the source choice. Allow browser session storage and retry.')}</p>}
        {selectionError && <p className="dc-error" role="alert">{t('Selection could not be saved. It remains available on this page, but may reset after navigation.')}</p>}
        <dl className="dc-stats" aria-label={t('Replay summary')}>
            <div><dt>{t('Dataset')}</dt><dd>{data.wafers.length}</dd><small>{t('wafers')}</small></div>
            <div><dt>{t('completed devices')}</dt><dd>{total.devices.toLocaleString()}</dd><small>{t('Source-reported')}</small></div>
            <div><dt>{t('Recorded alerts')}</dt><dd>{total.alerts}</dd><small>{t('Source-reported')}</small></div>
            <div><dt>{t('Tester receipt')}</dt><dd>{t('Not provided')}</dd><small>{t('No receipt in this summary')}</small></div>
        </dl>
        <section className="dc-evidence-panel"><div className="dc-tabbar isw-tabs" role="tablist" aria-label={t('Run views')}>{tabs.map(([id, title], index) => <button key={id} id={`summary-tab-${id}`} role="tab" aria-controls="summary-panel" aria-selected={selection.tab === id} tabIndex={selection.tab === id ? 0 : -1} onClick={() => select({ tab: id })} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
            if (next !== null) { event.preventDefault(); select({ tab: tabs[next][0] }); document.getElementById(`summary-tab-${tabs[next][0]}`)?.focus(); }
        }}>{t(title)}</button>)}</div>
        <div id="summary-panel" role="tabpanel" tabIndex={0} aria-labelledby={`summary-tab-${selection.tab}`}>
            {selection.tab === 'analysis' && <div className="isw-evidence"><aside className="isw-wafers"><label>{t('Filter wafers')}<select value={selection.filter} onChange={event => filterWafers(event.target.value)}><option value="all">{t('All')}</option><option value="alert">{t('With alerts')}</option><option value="quiet">{t('No alerts')}</option></select></label><p className="isw-note">{t('Source order · yield and alert counts. This is not a spatial wafer map.')}</p>
                <div className="isw-wafer-list">{visible.map(item => <button key={item.wafer} type="button" aria-pressed={selection.waferId === item.wafer} aria-expanded={selection.waferId === item.wafer && selection.detailOpen} aria-controls={selection.waferId === item.wafer ? 'summary-wafer-detail' : undefined} onClick={() => select(item.wafer === selection.waferId ? { detailOpen: !selection.detailOpen } : { waferId: item.wafer, alertIndex: 0, detailOpen: true })}><strong>W{item.wafer}</strong><span>{(item.yield * 100).toFixed(1)}%</span><small>{t('{0} alerts', item.alerts.length)}</small></button>)}</div>
                {!visible.length && <p>{t('No wafers match this filter.')}</p>}
            </aside><div className="dc-detail">{wafer ? <><button type="button" className="dc-secondary" aria-expanded={selection.detailOpen} aria-controls="summary-wafer-detail" onClick={() => select({ detailOpen: !selection.detailOpen })}>{t('Wafers & alerts')} · W{wafer.wafer}</button><section id="summary-wafer-detail" hidden={!selection.detailOpen}>
                <h2>W{wafer.wafer} · {wafer.devices} {t('devices')}</h2><dl className="isw-values"><div><dt>{t('Cumulative yield')}</dt><dd>{(wafer.yield * 100).toFixed(2)}%</dd></div><div><dt>{t('Dataset label')}</dt><dd>{alertNames[wafer.expected] ? t(alertNames[wafer.expected]) : wafer.expected}</dd></div></dl><p className="isw-note">{t('Evaluation only; not a detector rule')}</p>
                <p>{t('Source expected_first_device: {0}', wafer.expected_first_device ?? t('Not provided'))}</p>
                {!wafer.alerts.length ? <div className="dc-empty"><h3>{t('No alerts recorded for this wafer')}</h3><p>{t('No alerts does not establish normal operation. Review the source evaluation and limitations.')}</p></div> : <><div className="isw-alerts" role="group" aria-label={t('Select alert evidence')}>{wafer.alerts.map((item, index) => <button key={index} className="dc-secondary" type="button" aria-pressed={selection.alertIndex === index} onClick={() => select({ alertIndex: index })}>{t(alertNames[item.kind])} #{index + 1}</button>)}</div>
                    {alert && <article><h3>{t(alertNames[alert.kind])} · {alert.site === 'all' ? t('All sites') : t('Site {0}', alert.site)}</h3><p className="dc-message">{alert.message}</p><p>{t('Detected after')} {alert.completed_devices} {t('devices')}</p><p>{t('Test ·')} {alert.test}</p>
                        <dl className="isw-values"><div><dt>{t('Observed')}</dt><dd>{formatObservation(alert, alert.observed)}</dd></div><div><dt>{t('Reference')}</dt><dd>{formatObservation(alert, alert.reference)}</dd></div><div><dt>{t('Score · not probability')}</dt><dd>{alert.score.toFixed(3)}</dd></div></dl>
                        <SummaryPlot alert={alert}/><p className="isw-note">{t('Local reference · wafer_id=')}{wafer.wafer}{t(', alerts[')}{selection.alertIndex}{t('] (not a backend event ID)')}</p><h4>{t('Source recommendation')}</h4><p>{alert.suggestion}</p><SourceJson label={t('View source alert fields')} value={alert}/>
                    </article>}</>}<SourceJson label={t('View source wafer fields')} value={wafer}/></section></> : <div className="dc-empty"><h3>{t('No wafer selected')}</h3><p>{t('Change the wafer filter to select evidence.')}</p></div>}</div></div>}
            {selection.tab === 'validation' && <section className="isw-section"><h2>{t('Model validation')}</h2><p>{data.validation.mode ?? t('Validation method not provided')}</p><p>{data.validation.units ?? t('Raw values · units unverified')}</p><p className="isw-note">{t('Dataset metrics do not establish live prediction accuracy, latency or tester receipt. Full feature coverage does not imply perfect accuracy.')}</p><div className="isw-table" tabIndex={0} role="region" aria-label={t('Model validation table; scroll horizontally')}><table><thead><tr>{['Stage', 'Samples', 'Model MAE', 'Baseline MAE', 'RMSE', 'Worst error'].map(title => <th key={title}>{t(title)}</th>)}</tr></thead><tbody>{Object.entries(data.validation.metrics).map(([stage, metrics]) => <tr key={stage}><th scope="row">{stage}</th><td>{metrics.n}</td><td>{metrics.mae.toFixed(5)}</td><td>{metrics.baseline_mae.toFixed(5)}</td><td>{metrics.rmse.toFixed(5)}</td><td>{metrics.worst_error.toFixed(5)}</td></tr>)}</tbody></table></div>{!Object.keys(data.validation.metrics).length && <p>{t('Not provided')}</p>}<SourceJson label={t('Source validation fields')} value={data.validation}/></section>}
            {selection.tab === 'limitations' && <section className="isw-section"><h2>{t('Evidence limitations')}</h2><div className="isw-callout"><TriangleAlert size={20}/><p>{t('This summary supplies no live provenance, complete event timestamps or tester receipts. A final-device alert does not prove delivery before wafer completion.')}</p></div><h3>{t('Source limitations')}</h3><p>{t('Source messages, suggestions and limitations are displayed verbatim.')}</p>{data.limitations.length ? <ul>{data.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : <p>{t('No limitations supplied by this source. This does not establish acceptance.')}</p>}<p>{t('Source live_integration:')} <code>{data.live_integration}</code>{t('. This records the source file state, not the current remote status.')}</p></section>}
        </div></section>
        <section className="isw-section isw-source-record"><h2>{t('Unavailable in this summary')}</h2><div className="isw-unavailable">{unavailableSections.map(([title, description]) => <article key={title}><h3>{t(title)}</h3><p>{t(description)}</p></article>)}</div><a className="dc-secondary" href="#load-backend-run">{t('Load backend run')}</a></section>
        <section className="isw-section isw-source-record"><h2>{t('Source evidence')}</h2><p className="isw-note">{t('Source messages, suggestions and limitations are displayed verbatim.')}</p><SourceJson label={t('View complete summary JSON')} value={data}/></section>
    </main></div></div>;
}
