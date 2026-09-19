'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Database, Radio, RefreshCw } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';
import { createRunDiscovery, initialRunDiscovery, runChoiceKey, runModeLabel, selectedStoredRun } from '@/lib/rtdi/run-discovery';
import './stored-run-picker.css';

type Props = {
  onLoad: (run: string, tester: string) => void | Promise<void>;
  busy?: boolean; imported?: boolean; children?: ReactNode;
};

export function StoredRunPicker({ onLoad, busy = false, imported = false, children }: Props) {
  const { t, locale } = useLocale();
  const id = useId();
  const [state, setState] = useState(initialRunDiscovery);
  const discovery = useRef<ReturnType<typeof createRunDiscovery> | null>(null);
  const [manual, setManual] = useState(false);
  const [run, setRun] = useState(''), [tester, setTester] = useState('');
  useEffect(() => {
    const controller = createRunDiscovery((...args) => fetch(...args), setState);
    discovery.current = controller;
    void controller.refresh();
    return () => { controller.dispose(); discovery.current = null; };
  }, []);
  const selected = selectedStoredRun(state);
  const canLoad = !busy && (manual ? Boolean(run.trim()) : Boolean(selected) && !state.loading);
  const time = (value: string, database = false) => {
    // SQLite CURRENT_TIMESTAMP is UTC, without an explicit timezone suffix.
    const date = new Date(database && !/Z|[+-]\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
  };
  return <section className="dc-run-picker" aria-label={t('Run selection')}>
    <form id={imported ? 'load-backend-run' : undefined} className="dc-connect" aria-busy={busy} onSubmit={event => {
      event.preventDefault();
      if (!canLoad) return;
      if (manual) void onLoad(run.trim(), tester.trim());
      else if (selected) void onLoad(selected.run_id, selected.tester_id);
    }}>
      <div className="dc-connect-title"><Database size={18}/><div><strong>{t(imported ? 'Load backend run' : 'Run selection')}</strong><small>{t('Run and tester scope')}</small></div></div>
      {manual ? <>
        <label htmlFor={id + '-run'}>{t('Run ID')}<input id={id + '-run'} value={run} onChange={event => setRun(event.target.value)} required maxLength={120}/></label>
        <label htmlFor={id + '-tester'}>{t('Tester ID')}<input id={id + '-tester'} value={tester} onChange={event => setTester(event.target.value)} placeholder={t('Optional tester filter')} maxLength={120}/></label>
      </> : <label className="dc-stored-run-label" htmlFor={id + '-stored'}>{t('Stored run · Tester ID / Run ID')}
        <select id={id + '-stored'} value={state.selected} aria-describedby={id + '-status ' + id + '-note'} disabled={state.loading || !state.runs.length} onChange={event => discovery.current?.select(event.target.value)}>
          <option value="">{t('Choose a stored run')}</option>
          {state.runs.map(item => <option key={runChoiceKey(item)} value={runChoiceKey(item)}>{item.tester_id} / {item.run_id} · {t(runModeLabel(item.mode))}</option>)}
        </select>
      </label>}
      <button className="dc-primary" type="submit" disabled={!canLoad}><Radio size={16}/>{t(imported ? 'Load backend run' : 'Load run')}</button>
      <button className="dc-secondary" type="button" disabled={state.loading} onClick={() => void discovery.current?.refresh()}><RefreshCw size={16}/>{t('Refresh runs')}</button>
      {children}
    </form>
    <div className="dc-run-discovery">
      <p id={id + '-status'} role="status" aria-live="polite">{state.loading ? t('Finding stored runs…') : state.error ? t('Could not refresh stored runs. Retry with Refresh runs.') : !state.loaded ? '' : !state.runs.length ? t('No stored runs found. Refresh after data is received, or enter a known ID.') : t('{0} stored runs shown · Most recently updated first', state.runs.length)}</p>
      {state.error && state.runs.length > 0 && <p>{t('Showing the last fetched list; it may be out of date.')}</p>}
      {state.nextOffset !== null && <button className="dc-secondary" type="button" disabled={state.loading} onClick={() => void discovery.current?.more()}>{t('Show more runs')}</button>}
      {!manual && selected && <dl className="dc-run-metadata">
        <div><dt>{t('Source mode')}</dt><dd>{t(runModeLabel(selected.mode))}</dd></div>
        <div><dt>{t('Edge ID')}</dt><dd>{selected.edge_id}</dd></div>
        <div><dt>{t('Last source event')}</dt><dd>{time(selected.last_event_at)}</dd></div>
        <div><dt>{t('Last stored update')}</dt><dd>{time(selected.updated_at, true)}</dd></div>
      </dl>}
      <p id={id + '-note'}>{t('Selection takes effect only after Load. Live is source-reported; stored records do not prove current tester connectivity.')}</p>
      <button className="dc-secondary" type="button" aria-pressed={manual} onClick={() => setManual(value => !value)}>{t(manual ? 'Choose from stored runs' : 'Enter IDs manually')}</button>
    </div>
  </section>;
}
