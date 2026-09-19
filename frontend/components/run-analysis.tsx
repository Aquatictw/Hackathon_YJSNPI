'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowRight, Unplug} from 'lucide-react';
import {useLocale} from '@/components/locale-provider';
import {AppHeader} from '@/components/app-header';
import {StoredRunPicker} from '@/components/stored-run-picker';
import {TemperatureRecords} from '@/components/temperature-records';
import {BackendConnectionStatus, SourceFreshness, StoredSourceNotice} from '@/components/connection-status';
import {createDashboardLifecycle, dashboardEvidence, initialDashboardState} from '@/lib/rtdi/ui-lifecycle';
import {analysisSeries, prepareAnalysisWorkspace, selectAnalysisSource, summarizeRunAnalysis, type AnalysisSource} from '@/lib/rtdi/run-analysis';
import type {Snapshot} from '@/lib/rtdi/dashboard';
import '@/app/dashboard.css';
import './run-analysis.css';

export function RunAnalysisSourceChooser({source, onChange}: {source: AnalysisSource; onChange: (source: AnalysisSource) => void}) {
  const {t} = useLocale();
  return <div className="run-analysis-source" role="group" aria-label={t('Analysis source')}>
    <span>{t('Analysis source')}</span>
    <button type="button" aria-pressed={source === 'backend'} onClick={() => onChange('backend')}>{t('Stored / live backend run')}</button>
    <button type="button" aria-pressed={source === 'archive'} onClick={() => onChange('archive')}>{t('Offline JSON archive')}</button>
  </div>;
}

function SourceTime({value}: {value: string}) {
  const {locale} = useLocale();
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? <>{value}</> : <time dateTime={time.toISOString()}>{time.toLocaleString(locale, {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})}</time>;
}

function RunAnalysisChart({event}: {event: Snapshot['evidence'][number]}) {
  const {t} = useLocale();
  const lines = analysisSeries(event);
  if (!lines.length) return <p className="run-analysis-missing">{t('No sequence supplied. A chart is unavailable.')}</p>;
  const values = lines.flatMap(line => line.values);
  const low = Math.min(...values), high = Math.max(...values), pad = Math.max((high - low) * .1, .001);
  const min = low - pad, max = high + pad, count = Math.max(...lines.map(line => line.values.length));
  const x = (i: number) => 60 + i / Math.max(1, count - 1) * 530;
  const y = (value: number) => 180 - (value - min) / (max - min) * 155;
  const label = (value: number) => event.kind === 'low_yield' ? (value * 100).toFixed(1) + '%' : value.toPrecision(4);
  return <div className="run-analysis-chart"><svg viewBox="0 0 620 220" role="img" aria-label={t('Source measurement series. The x-axis is completed-device order per site, not event time.')}>
    {[0, 1, 2, 3].map(i => {const value = min + (max - min) * i / 3; return <g key={i}><path d={'M60 ' + y(value) + 'H590'} stroke="var(--border)"/><text x="50" y={y(value) + 4} textAnchor="end">{label(value)}</text></g>;})}
    {lines.map((line, i) => <g key={line.site ?? 'all'}><path d={line.values.map((value, j) => (j ? 'L' : 'M') + x(j) + ' ' + y(value)).join(' ')} stroke={'var(--chart-' + (i % 5 + 1) + ')'} strokeWidth="2.5" fill="none"/>{line.values.length === 1 && <circle cx={x(0)} cy={y(line.values[0])} r="3" fill={'var(--chart-' + (i % 5 + 1) + ')'}/>}</g>)}
    {[0, Math.floor((count - 1) / 2), count - 1].map((value, i) => <text key={i} x={x(value)} y="207" textAnchor="middle">{value + 1}</text>)}
  </svg><div className="run-analysis-legend">{lines.map((line, i) => <span key={line.site ?? 'all'}><i style={{background: 'var(--chart-' + (i % 5 + 1) + ')'}}/>{line.site === null ? t(event.kind === 'low_yield' ? 'Cumulative yield' : 'Observed series') : t('Site {0}', line.site)}</span>)}</div><p>{t('Completed-device order per site')} · {event.kind === 'low_yield' ? t('Percent') : event.unit ?? t('Unit unconfirmed')}</p></div>;
}

export function RunAnalysis({sourceChooser}: {sourceChooser: ReactNode}) {
  const {t} = useLocale();
  const [state, setState] = useState(initialDashboardState);
  const [navigationError, setNavigationError] = useState('');
  const lifecycle = useRef<ReturnType<typeof createDashboardLifecycle> | null>(null);
  useEffect(() => {
    const controller = createDashboardLifecycle({fetch: (...args) => fetch(...args), eventSource: url => new EventSource(url)}, setState,
      {conversationStorage: {getItem: key => window.sessionStorage.getItem(key), setItem: (key, value) => window.sessionStorage.setItem(key, value)}});
    lifecycle.current = controller;
    void controller.restoreSession();
    return () => {controller.dispose(); lifecycle.current = null;};
  }, []);
  const {data, status, error, scope} = state;
  const {evidence, current} = dashboardEvidence(state);
  const overview = data ? summarizeRunAnalysis(data) : null;
  const load = async (run: string, tester: string) => {
    try {selectAnalysisSource('backend'); setNavigationError('');}
    catch {setNavigationError('The source choice could not be saved. Allow browser session storage and retry.'); return;}
    await lifecycle.current?.connect(run, tester);
  };
  return <div className="dc-app"><AppHeader active="replay"/><div className="dc-main"><main id="main-content" className="run-analysis">
    {sourceChooser}
    <div className="dc-heading"><div><div className="dc-eyebrow">{t('BACKEND / RUN ANALYSIS')}</div><h1>{t('Replay analysis')}</h1><p>{t('Analyze backend records as source updates arrive.')}</p></div><BackendConnectionStatus status={status}/></div>
    <StoredRunPicker onLoad={load} busy={status === 'Connecting'}>{scope && <button className="dc-icon" type="button" aria-label={t('Disconnect event stream')} onClick={() => lifecycle.current?.disconnect()}><Unplug size={18}/></button>}</StoredRunPicker>
    {(error || navigationError) && <p className="dc-error" role="alert">{t(error || navigationError)}</p>}
    <StoredSourceNotice source={data?.run ?? null}/>
    {data && <dl className="dc-loaded-run">
      <div><dt>{t('Loaded run')}</dt><dd>{data.run.run_id}</dd></div><div><dt>{t('Tester ID')}</dt><dd>{data.run.tester_id}</dd></div>
      <div><dt>{t('Last source event')}</dt><dd><SourceTime value={data.run.last_event_at}/><SourceFreshness source={data.run}/></dd></div>
    </dl>}
    <dl className="dc-stats dc-workspace-stats" aria-label={t('Run summary')}>
      <div><dt>{t('Incidents')}</dt><dd>{overview?.incidents ?? '—'}</dd><small>{t('Source-reported')}</small></div>
      <div><dt>{t('Evidence records')}</dt><dd>{overview?.evidence ?? '—'}</dd><small>{overview ? t('{0} source events', overview.eventCount) : t('Awaiting snapshot')}</small></div>
      <div><dt>{t('Temperature predictions')}</dt><dd>{overview?.predictions.length ?? '—'}</dd><small>{overview ? t('{0} matched actuals', overview.matchedActuals) : t('Awaiting snapshot')}</small></div>
    </dl>
    {data && overview ? <>
      <div className="run-analysis-context"><dl><div><dt>{t('Lot')}</dt><dd>{overview.lots.join(', ') || t('Not provided')}</dd></div><div><dt>{t('Wafers')}</dt><dd>{overview.wafers.join(', ') || t('Not provided')}</dd></div></dl>
        <a href="/workspace" onClick={event => {try {prepareAnalysisWorkspace({run: data.run.run_id, tester: data.run.tester_id}, window.sessionStorage);} catch {event.preventDefault(); setNavigationError('The selected run could not be saved. Allow browser session storage and load it again.');}}}>{t('Open this run in workspace')}<ArrowRight size={16}/></a>
      </div>
      <section className="run-analysis-evidence" aria-label={t('Evidence records')}>
        <div className="run-analysis-record-list"><h2>{t('Evidence records')}</h2>{evidence.map(event => <button type="button" key={event.event_id} aria-pressed={current?.event_id === event.event_id} onClick={() => lifecycle.current?.selectEvidence(event.event_id)}><strong>{event.kind ?? t('Evidence')}</strong><span>{t('WAFER')} {event.wafer_id ?? '—'} · {event.site_id ? t('Site {0}', event.site_id) : t('All sites')}</span><SourceTime value={event.timestamp}/></button>)}{!evidence.length && <p>{t('No evidence in this scope')}</p>}</div>
        <div className="run-analysis-detail">{current ? <><h2>{current.kind ?? t('Evidence')}</h2><p>{current.message ?? t('No source description provided')}</p><SourceTime value={current.timestamp}/><RunAnalysisChart event={current}/>
          <details><summary>{t('Record identity & raw JSON')}</summary><pre>{JSON.stringify(current, null, 2)}</pre></details></> : <p>{t('No reported alert does not establish normal operation.')}</p>}</div>
      </section>
      <section className="run-analysis-coverage"><h2>{t('Yield & measurement coverage')}</h2>
        {overview.yields.length ? <><p>{t('Source-reported yield by record; no combined run yield is inferred.')}</p><ul>{overview.yields.slice(0, 8).map(event => <li key={event.event_id}>{t('Lot')} {event.lot_id ?? '—'} · {t('WAFER')} {event.wafer_id ?? '—'} · {event.site_id ? t('Site {0}', event.site_id) : t('Site not provided')} · <strong>{(event.yield! * 100).toFixed(2)}%</strong> · <SourceTime value={event.timestamp}/></li>)}</ul>{overview.yields.length > 8 && <p>{t('Showing the latest 8 supplied yield records.')}</p>}</> : <p>{t('Yield unavailable: this snapshot has no yield records.')}</p>}
        <p>{t('{0} normalized measurement records. Full measurement coverage is not established by this snapshot.', overview.measurements)}</p>
      </section>
      <section className="run-analysis-temperature"><h2>{t('Temperature predictions')}</h2><TemperatureRecords predictions={overview.predictions}/></section>
    </> : <div className="dc-empty"><h2>{t('No run loaded')}</h2><p>{t('Load a backend run above, or choose Offline JSON archive for saved summaries.')}</p></div>}
  </main></div></div>;
}
