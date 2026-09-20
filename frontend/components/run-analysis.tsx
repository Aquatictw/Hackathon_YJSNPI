'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowRight, ChevronRight, Unplug} from 'lucide-react';
import {useLocale} from '@/components/locale-provider';
import {AppHeader} from '@/components/app-header';
import {RunNotifications} from '@/components/run-notifications';
import {StoredRunPicker} from '@/components/stored-run-picker';
import WaferScene from '@/components/wafer-scene';
import {analysisWafers, type AnalysisWafer} from '@/lib/rtdi/analysis-wafers';
import {BackendConnectionStatus, SourceFreshness, StoredSourceNotice} from '@/components/connection-status';
import {createDashboardLifecycle, initialDashboardState} from '@/lib/rtdi/ui-lifecycle';
import {prepareAnalysisWorkspace, summarizeRunAnalysis} from '@/lib/rtdi/run-analysis';
import '@/app/dashboard.css';
import './run-analysis.css';

function SourceTime({value}: {value: string}) {
  const {locale} = useLocale();
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? <>{value}</> : <time dateTime={time.toISOString()}>{time.toLocaleString(locale, {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})}</time>;
}

// Rank defaults only; source groups and explicit user choices retain their identity.
function defaultWaferRank(wafer: AnalysisWafer) {
  if (!wafer.lastEventAt) return 0; // Metadata alone is not source data.
  if (wafer.waferId === null) return 1;
  return wafer.yieldRatio !== undefined || wafer.devices !== undefined
    || wafer.alerts > 0 || wafer.predictions > 0 || wafer.matchedActuals > 0 ? 3 : 2;
}

export function RunAnalysis({initialScope, onSummary}: {initialScope?: {run: string; tester: string}; onSummary?: () => void} = {}) {
  const {t} = useLocale();
  const [state, setState] = useState(initialDashboardState);
  const [navigationError, setNavigationError] = useState('');
  const lifecycle = useRef<ReturnType<typeof createDashboardLifecycle> | null>(null);
  useEffect(() => {
    const controller = createDashboardLifecycle({fetch: (...args) => fetch(...args), eventSource: url => new EventSource(url)}, setState,
      {conversationStorage: {getItem: key => window.sessionStorage.getItem(key), setItem: (key, value) => window.sessionStorage.setItem(key, value)}});
    lifecycle.current = controller;
    if (initialScope) void controller.connect(initialScope.run, initialScope.tester);
    else void controller.restoreSession();
    return () => {controller.dispose(); lifecycle.current = null;};
  }, [initialScope]);
  const {data, status, error, scope} = state;
  const overview = useMemo(() => data ? summarizeRunAnalysis(data) : null, [data]);
  const wafers = useMemo(() => data ? analysisWafers(data) : [], [data]);
  const [selection, setSelection] = useState({scope: '', key: '', open: true, explicit: false});
  const sourceKey = JSON.stringify([data?.run.tester_id, data?.run.run_id]);
  const preferred = wafers.reduce<AnalysisWafer | undefined>((best, item) =>
    !best || defaultWaferRank(item) > defaultWaferRank(best) ? item : best, undefined);
  const selected = selection.scope === sourceKey ? wafers.find(item => item.key === selection.key) : undefined;
  const wafer = selected && (selection.explicit || !preferred || defaultWaferRank(selected) >= defaultWaferRank(preferred))
    ? selected : preferred;
  useEffect(() => {
    if (wafer && (selection.scope !== sourceKey || selection.key !== wafer.key)) {
      setSelection({scope: sourceKey, key: wafer.key, open: true, explicit: false});
    }
  }, [sourceKey, wafer, selection.scope, selection.key]);
  const detailOpen = selection.scope !== sourceKey || selection.key !== wafer?.key || selection.open;
  const chooseWafer = (key: string) => setSelection({scope: sourceKey, key, open: true, explicit: true});
  const waferLabel = (id: string | null) => id === null ? t('Wafer not provided') : t('Wafer {0}', id);
  const load = async (run: string, tester: string) => {
    setNavigationError('');
    await lifecycle.current?.connect(run, tester);
  };
  return <div className="shell replay-shell"><AppHeader active="replay"/><main id="main-content" className="workspace replay-workspace run-analysis">
    <div className="heading"><div><div className="eyebrow">{t('WAFER OVERVIEW / RUN ANALYSIS')}</div><h1>{t('Wafer Analysis')}</h1><p className="sub">{t('Explore each wafer as source updates arrive.')}</p></div>
      <div className="replay-actions"><BackendConnectionStatus status={status}/><button type="button" className="analysis-next" disabled={wafers.length < 2} onClick={() => chooseWafer(wafers[(wafers.findIndex(item => item.key === wafer?.key) + 1) % wafers.length].key)}>{t('Next wafer')}<ChevronRight size={16}/></button></div>
    </div>
    <StoredRunPicker onLoadSummary={onSummary} onLoad={load} busy={status === 'Connecting'}>{scope && <button className="dc-icon" type="button" aria-label={t('Disconnect event stream')} onClick={() => lifecycle.current?.disconnect()}><Unplug size={18}/></button>}</StoredRunPicker>
    {(error || navigationError) && <p className="dc-error" role="alert">{t(error || navigationError)}</p>}
    <StoredSourceNotice source={data?.run ?? null}/>
    <WaferScene waferId={wafer?.waferId ?? undefined} yieldRatio={wafer?.yieldRatio} devices={wafer?.devices}/>
    {data && <dl className="dc-loaded-run">
      <div><dt>{t('Loaded run')}</dt><dd>{data.run.run_id}</dd></div><div><dt>{t('Tester ID')}</dt><dd>{data.run.tester_id}</dd></div>
      <div><dt>{t('Last source event')}</dt><dd><SourceTime value={data.run.last_event_at}/><SourceFreshness source={data.run}/></dd></div>
    </dl>}
    {data && overview ? <>
      <div className="analysis-overview-heading"><h2>{t('Wafer groups')} <span>{wafers.length}</span></h2>
        <a className="run-analysis-workspace-link" href="/workspace" onClick={event => {try {prepareAnalysisWorkspace({run: data.run.run_id, tester: data.run.tester_id}, window.sessionStorage);} catch {event.preventDefault(); setNavigationError('The selected run could not be saved. Allow browser session storage and load it again.');}}}>{t('Open this run in workspace')}<ArrowRight size={16}/></a>
      </div>
      <div className="analysis-wafer-layout">
        <section className="panel wafer-panel" aria-label={t('Select wafer')}>
          <p className="wafer-hint">{t('Grouped by lot and wafer. Select a wafer to explore its yield and activity.')}</p>
          <div className="wafer-tiles analysis-wafer-grid">{wafers.map(item => <button type="button" key={item.key} className={'wafer-tile ' + (item.alerts ? 'alert ' : 'quiet ') + (item.key === wafer?.key ? 'active' : '')} aria-pressed={item.key === wafer?.key} aria-expanded={item.key === wafer?.key && detailOpen} aria-controls="analysis-wafer-detail" onClick={() => item.key === wafer?.key ? setSelection({scope: sourceKey, key: item.key, open: !detailOpen, explicit: true}) : chooseWafer(item.key)}>
            <strong>{waferLabel(item.waferId)}</strong><span>{item.yieldRatio === undefined ? t('Yield unavailable') : (item.yieldRatio * 100).toFixed(2) + '%'}</span><small>{t('Lot')} {item.lotId ?? t('Not provided')}</small><small>{t('{0} alerts', item.alerts)}</small>
          </button>)}</div>
          {!wafers.length && <p className="wafer-hint">{t('No wafer records supplied.')}</p>}
        </section>
        {wafer && <section id="analysis-wafer-detail" hidden={!detailOpen} className="panel replay-detail analysis-wafer-detail">
          <div className="panel-header"><h2>{waferLabel(wafer.waferId)}</h2><span className="detail-site-label">{t('Lot')} {wafer.lotId ?? t('Not provided')}</span></div>
          <dl className="analysis-wafer-metrics">
            <div><dt>{t('Cumulative yield')}</dt><dd>{wafer.yieldRatio === undefined ? '—' : (wafer.yieldRatio * 100).toFixed(2) + '%'}</dd></div>
            <div><dt>{t('Completed devices')}</dt><dd>{wafer.devices?.toLocaleString() ?? '—'}</dd></div>
            <div><dt>{t('Recorded alerts')}</dt><dd>{wafer.alerts}</dd></div>
            <div><dt>{t('Temperature predictions')}</dt><dd>{wafer.predictions.toLocaleString()}</dd><small>{t('{0} matched actuals', wafer.matchedActuals)}</small></div>
          </dl>
          <div className="analysis-wafer-notes"><p>{t('Latest supplied wafer summary. Missing yield or device counts remain unavailable.')}</p>
            {wafer.lastEventAt && <div className="analysis-wafer-time"><span>{t('Last source event')}</span><SourceTime value={wafer.lastEventAt}/></div>}
            <p>{t('Open Run workspace for incident evidence and individual temperature records.')}</p>
          </div>
        </section>}
      </div>
      <section className="run-analysis-coverage"><h2>{t('Yield & measurement coverage')}</h2>
        {overview.yields.length ? <><p>{t('Source-reported yield by record; no combined run yield is inferred.')}</p><ul>{overview.yields.slice(0, 8).map(event => <li key={event.event_id}>{t('Lot')} {event.lot_id ?? '—'} · {t('WAFER')} {event.wafer_id ?? '—'} · {event.site_id ? t('Site {0}', event.site_id) : t('Site not provided')} · <strong>{(event.yield! * 100).toFixed(2)}%</strong> · <SourceTime value={event.timestamp}/></li>)}</ul>{overview.yields.length > 8 && <p>{t('Showing the latest 8 supplied yield records.')}</p>}</> : <p>{t('Yield unavailable: this snapshot has no yield records.')}</p>}
        <p>{t('{0} normalized measurement records. Full measurement coverage is not established by this snapshot.', overview.measurements)}</p>
      </section>
    </> : <div className="dc-empty"><h2>{t('No run loaded')}</h2><p>{t('Choose a stored run above to explore its wafers.')}</p></div>}
  </main><RunNotifications items={state.notifications} onDismiss={id => lifecycle.current?.dismissNotification(id)}/></div>;
}
