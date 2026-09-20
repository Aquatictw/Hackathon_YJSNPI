import { z } from 'zod';

export const storedRunSchema = z.object({
  run_id: z.string().min(1), tester_id: z.string().min(1), edge_id: z.string(),
  mode: z.enum(['live', 'replay', 'simulation']),
  archived: z.boolean().default(false), finished: z.boolean().default(false),
  last_event_at: z.string(), updated_at: z.string(),
});
export type StoredRun = z.infer<typeof storedRunSchema>;
export const runListSchema = z.object({
  runs: z.array(storedRunSchema).max(100),
  next_offset: z.number().int().nonnegative().nullable(),
});
export const runChoiceKey = (run: Pick<StoredRun, 'run_id' | 'tester_id'>) => JSON.stringify([run.tester_id, run.run_id]);
export const storedRunCategory = (run: Pick<StoredRun, 'mode' | 'archived'>) => run.mode === 'live' && !run.archived ? 'live' : 'replay';
export type ManagedRunScope = {run: string; tester: string};
export const runModeLabel = (mode: StoredRun['mode']) => ({
  live: 'STORED · LIVE-SOURCE RECORDS', replay: 'REPLAY · IMPORTED RECORDS', simulation: 'SIMULATION',
})[mode];
export const isRecordedCapture = (run: Pick<StoredRun, 'edge_id' | 'mode'>) =>
  run.edge_id === 'grp6-recorded-capture' && run.mode === 'replay';
export const isTrainingReplay = (run: Pick<StoredRun, 'edge_id' | 'tester_id' | 'run_id'>) =>
  run.edge_id === 'grp6-replay-exporter' && run.tester_id === 'grp6-replay' && run.run_id === 'grp6-replay-demo';
export const storedRunSourceLabel = (run: Pick<StoredRun, 'edge_id' | 'mode'>) =>
  isRecordedCapture(run) ? 'RECORDED · GEMINI CAPTURE' : runModeLabel(run.mode);
export const storedRunName = (run: StoredRun): string | null => {
  if (run.edge_id === 'grp6-hc-relay' && run.tester_id === 'group-6' && run.mode === 'live') {
    return 'Gemini run';
  }
  if (isRecordedCapture(run) && run.tester_id === 'group-6') {
    if (run.run_id === 'ae20cd5ae29d47af87163265205ffced') return 'Engineering check';
    if (run.run_id === 'd132133657be459e8e97b6fd442142e2') return 'Production run 3';
  }
  if (isTrainingReplay(run)) return 'Training-data replay';
  return null;
};
// User-retired recovery probes: retain backend evidence but omit them from both pickers.
const retiredRecoveryRuns = new Set(['4620bc260aef42329930bbf46d35b13f', '74c4e8ccd7f446d3bfcdf2ab7b668f6d', '80727b22581b44579471eebfb2ef4a5e']);
export const isRetiredRecoveryRun = (run: StoredRun) => run.tester_id === 'group-6' && run.edge_id === 'grp6-hc-relay' && run.mode === 'live' && retiredRecoveryRuns.has(run.run_id);
export type RunDiscoveryState = {
  runs: StoredRun[]; selected: string; loading: boolean; loaded: boolean; error: boolean; nextOffset: number | null;
  managing: boolean; managementError: string;
};
export const initialRunDiscovery = (): RunDiscoveryState => ({ runs: [], selected: '', loading: false, loaded: false, error: false, nextOffset: null, managing: false, managementError: '' });
export const selectedStoredRun = (state: RunDiscoveryState) => state.runs.find(run => runChoiceKey(run) === state.selected);

/** Discovery only edits a draft choice. Loading snapshots and changing the saved
 * source remain explicit actions in the workspace, never fetch side effects. */
export function createRunDiscovery(fetcher: typeof fetch, publish: (state: RunDiscoveryState) => void, filter: (run: StoredRun) => boolean = () => true) {
  let state = initialRunDiscovery(), generation = 0, disposed = false;
  let cancel: AbortController | undefined;
  const patch = (change: Partial<RunDiscoveryState>) => {
    if (!disposed) { state = { ...state, ...change }; publish(state); }
  };
  async function request(append: boolean) {
    if (disposed || state.managing || (append && (state.loading || state.nextOffset === null))) return;
    const offset = append ? state.nextOffset! : 0;
    cancel?.abort();
    const controller = new AbortController(); cancel = controller;
    const current = ++generation;
    patch({ loading: true, error: false });
    try {
      const response = await fetcher(`/api/v1/runs?limit=100&offset=${offset}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw Error('Run discovery unavailable');
      const payload = runListSchema.parse(await response.json());
      if (disposed || generation !== current) return;
      if (payload.next_offset !== null && payload.next_offset <= offset) throw Error('Invalid pagination');
      // Pagination follows the server page even when every fetched entry is excluded.
      const runs = [...new Map([...(append ? state.runs : []), ...payload.runs.filter(run => !isRetiredRecoveryRun(run) && filter(run))].map(run => [runChoiceKey(run), run])).values()];
      patch({ runs, loaded: true, loading: false, nextOffset: payload.next_offset,
        selected: runs.some(run => runChoiceKey(run) === state.selected) ? state.selected : '' });
    } catch {
      if (!disposed && generation === current) patch({ loading: false, error: true });
    }
  }
  return {
    refresh: () => request(false), more: () => request(true),
    async manage(action: 'archive' | 'delete', onDeleted: (scope: ManagedRunScope) => void) {
      const chosen = selectedStoredRun(state);
      if (disposed || state.managing || state.loading || !chosen
        || (action === 'archive' && (storedRunCategory(chosen) !== 'live' || !chosen.finished))) return false;
      const key = runChoiceKey(chosen);
      cancel?.abort(); generation++;
      patch({managing: true, managementError: ''});
      let succeeded = false;
      try {
        // A response abort cannot undo a server mutation. Finish deletion cleanup
        // even when the picker unmounts while its POST is pending.
        const response = await fetcher('/api/v1/runs/' + encodeURIComponent(chosen.run_id) + '/manage', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin',
          body: JSON.stringify({tester_id: chosen.tester_id, action}),
        });
        if (!response.ok) throw Error('management failed');
        z.object({ok: z.literal(true)}).parse(await response.json());
        succeeded = true;
        patch({runs: action === 'delete' ? state.runs.filter(run => runChoiceKey(run) !== key)
          : state.runs.map(run => runChoiceKey(run) === key ? {...run, archived: true} : run),
          selected: action === 'delete' && state.selected === key ? '' : state.selected});
        if (action === 'delete') onDeleted({run: chosen.run_id, tester: chosen.tester_id});
      } catch {
        patch({managementError: succeeded ? 'Run removed, but the saved session could not be cleared.' : 'Could not manage this run. Refresh runs and try again.'});
      } finally {patch({managing: false});}
      if (succeeded && !disposed) await request(false);
      return succeeded;
    },
    select: (selected: string) => {if (!state.managing) patch({ selected: state.runs.some(run => runChoiceKey(run) === selected) ? selected : '', managementError: '' });},
    dispose: () => { disposed = true; generation++; cancel?.abort(); },
  };
}
