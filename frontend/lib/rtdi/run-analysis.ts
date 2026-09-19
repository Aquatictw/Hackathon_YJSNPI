import type {Snapshot} from './dashboard.ts';
import {predictionRows} from './ui-predictions.ts';
import {createConversationCache, type ConversationStorage} from './ui-conversations.ts';
import {readSourceSession, selectBackendSource, writeSourceSession} from './source-session.ts';

export type AnalysisSource = 'backend' | 'archive';
export function initialAnalysisSource(): AnalysisSource {
  return readSourceSession()?.mode === 'summary' ? 'archive' : 'backend';
}

/** A view switch never destroys an imported summary or fabricates backend scope. */
export function selectAnalysisSource(mode: AnalysisSource) {
  const saved = readSourceSession();
  if (mode === 'archive' && saved?.replay) writeSourceSession({...saved, mode: 'summary'});
  else selectBackendSource();
}

export function prepareAnalysisWorkspace(scope: {run: string; tester: string}, storage: ConversationStorage) {
  const saved = createConversationCache(storage).lastScope();
  if (saved?.run !== scope.run || saved.tester !== scope.tester) throw Error('The selected run could not be saved. Allow browser session storage and load it again.');
  selectBackendSource();
}

export function summarizeRunAnalysis(snapshot: Snapshot) {
  const predictions = predictionRows(snapshot.events);
  const ids = (field: 'wafer_id' | 'lot_id') => [...new Set([
    snapshot.run[field], ...snapshot.events.map(event => event[field]), ...snapshot.evidence.map(event => event[field]),
  ].filter((value): value is string => Boolean(value)))];
  // Keep each supplied yield's scope/time. Do not average wafers, equate absent
  // yield with zero, or turn low-yield anomaly observations into a run aggregate.
  const yields = snapshot.events.filter(event => event.yield !== undefined)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return {
    incidents: snapshot.incidents.length, evidence: snapshot.evidence.length,
    eventCount: snapshot.events.length, predictions,
    matchedActuals: predictions.filter(row => row.actual !== undefined).length,
    measurements: snapshot.events.filter(event => event.type === 'measurement').length,
    wafers: ids('wafer_id'), lots: ids('lot_id'), yields,
  };
}

export function analysisSeries(event: Snapshot['evidence'][number]) {
  // Low-yield series are cumulative yield; site_series in such records may use
  // a different measurement scale and must not be overlaid on yield.
  if (event.kind !== 'low_yield') {
    const sites = Object.entries(event.site_series ?? {}).filter(([, values]) => values.length);
    if (sites.length) return sites.map(([site, values]) => ({site, values}));
  }
  return event.series?.length ? [{site: null, values: event.series}] : [];
}
