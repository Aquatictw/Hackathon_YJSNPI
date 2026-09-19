import { z } from 'zod';

export const storedRunSchema = z.object({
  run_id: z.string().min(1), tester_id: z.string().min(1), edge_id: z.string(),
  mode: z.enum(['live', 'replay', 'simulation']),
  last_event_at: z.string(), updated_at: z.string(),
});
export type StoredRun = z.infer<typeof storedRunSchema>;
export const runListSchema = z.object({
  runs: z.array(storedRunSchema).max(100),
  next_offset: z.number().int().nonnegative().nullable(),
});
export const runChoiceKey = (run: Pick<StoredRun, 'run_id' | 'tester_id'>) => JSON.stringify([run.tester_id, run.run_id]);
export const runModeLabel = (mode: StoredRun['mode']) => ({
  live: 'LIVE · SOURCE-REPORTED', replay: 'REPLAY · IMPORTED RECORDS', simulation: 'SIMULATION',
})[mode];
export type RunDiscoveryState = {
  runs: StoredRun[]; selected: string; loading: boolean; loaded: boolean; error: boolean; nextOffset: number | null;
};
export const initialRunDiscovery = (): RunDiscoveryState => ({ runs: [], selected: '', loading: false, loaded: false, error: false, nextOffset: null });
export const selectedStoredRun = (state: RunDiscoveryState) => state.runs.find(run => runChoiceKey(run) === state.selected);

/** Discovery only edits a draft choice. Loading snapshots and changing the saved
 * source remain explicit actions in the workspace, never fetch side effects. */
export function createRunDiscovery(fetcher: typeof fetch, publish: (state: RunDiscoveryState) => void) {
  let state = initialRunDiscovery(), generation = 0, disposed = false;
  let cancel: AbortController | undefined;
  const patch = (change: Partial<RunDiscoveryState>) => {
    if (!disposed) { state = { ...state, ...change }; publish(state); }
  };
  async function request(append: boolean) {
    if (disposed || (append && (state.loading || state.nextOffset === null))) return;
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
      const runs = [...new Map([...(append ? state.runs : []), ...payload.runs].map(run => [runChoiceKey(run), run])).values()];
      patch({ runs, loaded: true, loading: false, nextOffset: payload.next_offset,
        selected: runs.some(run => runChoiceKey(run) === state.selected) ? state.selected : '' });
    } catch {
      if (!disposed && generation === current) patch({ loading: false, error: true });
    }
  }
  return {
    refresh: () => request(false), more: () => request(true),
    select: (selected: string) => patch({ selected: state.runs.some(run => runChoiceKey(run) === selected) ? selected : '' }),
    dispose: () => { disposed = true; generation++; cancel?.abort(); },
  };
}
