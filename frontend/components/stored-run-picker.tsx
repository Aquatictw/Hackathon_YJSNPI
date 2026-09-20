'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Radio, RefreshCw, Trash2, ArrowUp } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';
import { createConversationCache } from '@/lib/rtdi/ui-conversations';
import { createRunDiscovery, initialRunDiscovery, isRecordedCapture, isTrainingReplay, runChoiceKey, storedRunName, storedRunSourceLabel, selectedStoredRun, storedRunCategory, type ManagedRunScope } from '@/lib/rtdi/run-discovery';
import './stored-run-picker.css';

type Props = {
  onLoad: (run: string, tester: string) => void | Promise<void>;
  busy?: boolean; imported?: boolean; children?: ReactNode;
  excludeTraining?: boolean; onLoadSummary?: () => void; summarySelected?: boolean;
  onDeleted?: (scope: ManagedRunScope) => void;
};

export function StoredRunPicker({ onLoad, busy = false, imported = false, children, excludeTraining = false, onLoadSummary, summarySelected = false, onDeleted }: Props) {
  const { t, locale } = useLocale();
  const id = useId();
  const [state, setState] = useState(initialRunDiscovery);
  const discovery = useRef<ReturnType<typeof createRunDiscovery> | null>(null);
  const [manual, setManual] = useState(false);
  const [archive, setArchive] = useState(summarySelected);
  const [run, setRun] = useState(''), [tester, setTester] = useState('');
  useEffect(() => {
    const controller = createRunDiscovery((...args) => fetch(...args), setState, excludeTraining ? run => !isTrainingReplay(run) : undefined);
    discovery.current = controller;
    void controller.refresh();
    return () => { controller.dispose(); discovery.current = null; };
  }, [excludeTraining]);
  const selected = selectedStoredRun(state);
  const locked = busy || state.managing;
  const canLoad = !locked && (manual ? Boolean(run.trim()) : (archive && Boolean(onLoadSummary)) || (Boolean(selected) && !state.loading));
  const canManage = Boolean(selected) && !locked && !state.loading && !manual && !archive;
  const canArchive = canManage && selected && storedRunCategory(selected) === 'live' && selected.finished;
  const forgetDeleted = (scope: ManagedRunScope) => {
    if (onDeleted) onDeleted(scope);
    else {
      // Offline views have no active backend controller. Read the latest saved
      // cache after the POST so unrelated session changes are retained.
      createConversationCache(window.sessionStorage).forget(scope);
    }
  };
  const remove = () => {
    if (!canManage || !selected) return;
    if (window.confirm(t('Permanently delete this run and all its stored records? This cannot be undone.') + '\n\n' + t('Run ID') + ': ' + selected.run_id + '\n' + t('Tester ID') + ': ' + selected.tester_id)) {
      void discovery.current?.manage('delete', forgetDeleted);
    }
  };
  const time = (value: string, database = false) => {
    // SQLite CURRENT_TIMESTAMP is UTC, without an explicit timezone suffix.
    const date = new Date(database && !/Z|[+-]\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
    return Number.isNaN(date.getTime()) ? value : <time dateTime={date.toISOString()}>{date.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</time>;
  };
  return <section className="dc-run-picker" aria-label={t('Run selection')}>
    <form id={imported ? 'load-backend-run' : undefined} className="dc-connect" aria-busy={locked} onSubmit={event => {
      event.preventDefault();
      if (!canLoad) return;
      if (manual) void onLoad(run.trim(), tester.trim());
      else if (archive && onLoadSummary) onLoadSummary();
      else if (selected) void onLoad(selected.run_id, selected.tester_id);
    }}>
      {manual ? <>
        <label htmlFor={id + '-run'}>{t('Run ID')}<input id={id + '-run'} value={run} onChange={event => setRun(event.target.value)} required maxLength={120}/></label>
        <label htmlFor={id + '-tester'}>{t('Tester ID')}<input id={id + '-tester'} value={tester} onChange={event => setTester(event.target.value)} placeholder={t('Optional tester filter')} maxLength={120}/></label>
      </> : <label className="dc-stored-run-label" htmlFor={id + '-stored'}>{t('Stored run · Tester ID / Run ID')}
        <select id={id + '-stored'} value={archive ? '__summary__' : state.selected} aria-describedby={id + '-status'} disabled={locked || (!onLoadSummary && (state.loading || !state.runs.length))} onChange={event => {setArchive(event.target.value === '__summary__'); discovery.current?.select(event.target.value);}}>
          <option value="">{t('Choose a stored run')}</option>
          {(['replay', 'live'] as const).map(category => <optgroup key={category} label={t(category === 'live' ? 'Live' : 'Replay')}>
            {category === 'replay' && onLoadSummary && <option value="__summary__">{t('summary.json · Offline wafer archive')}</option>}
            {state.runs.filter(item => storedRunCategory(item) === category).map(item => <option key={runChoiceKey(item)} value={runChoiceKey(item)}>{storedRunName(item) ? `${t(storedRunName(item)!)} · ` : ''}{t(storedRunSourceLabel(item))} · {item.tester_id} / {item.run_id}</option>)}
          </optgroup>)}
        </select>
      </label>}
      <button className="dc-primary" type="submit" disabled={!canLoad}><Radio size={16}/>{t(imported && !archive ? 'Load backend run' : 'Load run')}</button>
      <button className="dc-secondary" type="button" disabled={locked || state.loading} onClick={() => void discovery.current?.refresh()}><RefreshCw size={16}/>{t('Refresh runs')}</button>
      {children}
    </form>
    <div className="dc-run-discovery">
      <p id={id + '-status'} className="dc-run-discovery-status" role="status" aria-live="polite">{state.loading ? t('Finding stored runs…') : state.error ? t('Could not refresh stored runs. Retry with Refresh runs.') : state.loaded && !state.runs.length ? t('No stored runs found. Refresh after data is received, or enter a known ID.') : ''}</p>
      {state.error && state.runs.length > 0 && <p>{t('Showing the last fetched list; it may be out of date.')}</p>}
      {state.managementError && <p className="dc-run-management-error" role="alert">{t(state.managementError)}</p>}
      <div className="dc-run-management" role="group" aria-label={t('Manage selected run')} aria-busy={state.managing}>
        <button className="dc-secondary dc-run-remove" type="button" disabled={!canManage} onClick={remove}><Trash2 size={16} aria-hidden="true"/>{t('Remove')}</button>
        <button className="dc-secondary" type="button" disabled={!canArchive} aria-describedby={id + '-manage-note'} onClick={() => {if (canArchive) void discovery.current?.manage('archive', forgetDeleted);}}><ArrowUp size={16} aria-hidden="true"/>{t('Move to Replay')}</button>
        <span id={id + '-manage-note'} role="status">{state.managing ? t('Updating selected run…') : ''}</span>
      </div>
      {state.nextOffset !== null && <button className="dc-secondary" type="button" disabled={locked || state.loading} onClick={() => void discovery.current?.more()}>{t('Show more runs')}</button>}
      <div className="dc-run-options">
      <details className="dc-run-details">
        <summary>{t('Selection details')}</summary>
        <div className="dc-run-details-content">
        {state.loaded && <p>{t('{0} stored runs shown · Most recently updated first', state.runs.length)}</p>}
      {!manual && !archive && selected && <dl className="dc-run-metadata">
        <div><dt>{t('Run ID')}</dt><dd>{selected.run_id}</dd></div>
        <div><dt>{t('Tester ID')}</dt><dd>{selected.tester_id}</dd></div>
        <div><dt>{t('Source mode')}</dt><dd>{t(storedRunSourceLabel(selected))}</dd></div>
        <div><dt>{t('Edge ID')}</dt><dd>{selected.edge_id}</dd></div>
        <div><dt>{t('Last source event')}</dt><dd>{time(selected.last_event_at)}</dd></div>
        <div><dt>{t('Last stored update')}</dt><dd>{time(selected.updated_at, true)}</dd></div>
      </dl>}
        <p>{t('Selection takes effect only after Load. Live is source-reported; stored records do not prove current tester connectivity.')}</p>
        {selected?.mode === 'replay' && !manual && !archive && <p>{t(isRecordedCapture(selected) ? 'Recorded Gemini capture. Timestamps are the original machine event times; this is not a current feed.' : 'Replay timestamps represent import ordering.')}</p>}
        </div>
      </details>
      <button className="dc-secondary" type="button" disabled={locked} aria-pressed={manual} onClick={() => setManual(value => !value)}>{t(manual ? 'Choose from stored runs' : 'Enter IDs manually')}</button>
      </div>
    </div>
  </section>;
}
