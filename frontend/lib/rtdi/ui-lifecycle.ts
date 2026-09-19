import {z} from 'zod';
import {parseSnapshot, runUrl, type Snapshot} from './dashboard.ts';

type Scope = {run: string; tester: string};
type Message = {role: 'user' | 'assistant'; text: string; refs?: string[]; id?: string};
export type DashboardState = {
  scope: Scope | null; data: Snapshot | null; status: string; error: string;
  selected: string; search: string; question: string; busy: boolean;
  chatError: string; messages: Message[];
};
export const initialDashboardState = (): DashboardState => ({
  scope: null, data: null, status: '尚未連線', error: '', selected: '', search: '',
  question: '', busy: false, chatError: '', messages: [],
});
export function dashboardEvidence(state: DashboardState) {
  const evidence = state.data?.evidence ?? [];
  const filtered = evidence.filter(e => `${e.kind} ${e.wafer_id} ${e.message} ${e.test_name} ${e.affected_tests?.join(' ')}`.toLowerCase().includes(state.search.toLowerCase()));
  return {evidence, filtered, current: evidence.find(e => e.event_id === state.selected) ?? filtered[0]};
}
type Stream = {addEventListener(type: string, listener: () => void): void; onerror: EventSource['onerror']; close(): void};
type Transport = {fetch: typeof fetch; eventSource: (url: string) => Stream};
const errorText = (value: unknown) => value instanceof Error ? value.message : '讀取失敗';
const responseError = (payload: unknown, fallback: string) => z.object({error: z.string()}).safeParse(payload).data?.error ?? fallback;
const answerSchema = z.object({answer: z.string(), evidence_ids: z.array(z.string()).optional(), investigation_id: z.string().nullable().optional()});

/** The page and deferred-transport tests use this same lifecycle. Abort is only
 * resource cleanup: generation checks also reject transports that ignore it. */
export function createDashboardLifecycle(transport: Transport, publish: (state: DashboardState) => void) {
  let state = initialDashboardState();
  let generation = 0, chatGeneration = 0, disposed = false;
  let cancel: AbortController | undefined, chatCancel: AbortController | undefined, stream: Stream | undefined;
  const patch = (update: Partial<DashboardState>) => {
    if (disposed) return;
    state = {...state, ...update};
    publish(state);
  };
  const cancelChat = () => {chatGeneration++; chatCancel?.abort();};
  const stop = () => {generation++; cancel?.abort(); stream?.close(); stream = undefined; cancelChat();};
  const resetChat = () => {cancelChat(); patch({busy: false, messages: [], chatError: '', question: ''});};
  const context = () => {
    const current = dashboardEvidence(state).current;
    return JSON.stringify([current?.event_id, current?.incident_id]);
  };
  function acceptSnapshot(data: Snapshot, scope: Scope) {
    const before = context();
    // Pin the visible evidence so inserting a newer item cannot silently change
    // the incident while an investigation is pending.
    const next = {...state, data, scope};
    const selected = dashboardEvidence(next).current?.event_id ?? '';
    patch({data, scope, selected});
    if (context() !== before) resetChat();
  }
  async function connect(run: string, tester: string) {
    if (disposed || !run.trim()) return;
    const chosen = {run: run.trim(), tester: tester.trim()};
    const sameScope = state.scope?.run === chosen.run && state.scope.tester === chosen.tester;
    stop();
    const g = generation, active = () => !disposed && generation === g;
    const ctrl = new AbortController(); cancel = ctrl;
    patch({...(sameScope ? {} : initialDashboardState()), busy: false, chatError: '', question: '',
      error: '', status: sameScope ? '正在重新連線 · 保留上次資料' : '正在連線'});
    let refreshing = false, dirty = false, connected = false;
    async function refresh() {
      if (!active()) return false;
      if (refreshing) {dirty = true; return false;}
      refreshing = true;
      let succeeded = false;
      try {
        do {
          dirty = false;
          try {
            const response = await transport.fetch(runUrl(chosen.run, chosen.tester), {signal: ctrl.signal, cache: 'no-store'});
            const payload = await response.json();
            if (!active()) return false;
            if (!response.ok) throw Error(responseError(payload, `讀取失敗 (${response.status})`));
            const data = parseSnapshot(payload, chosen.run, chosen.tester);
            chosen.tester = data.run.tester_id;
            acceptSnapshot(data, {...chosen});
            patch({error: '', status: connected ? '事件流已連線' : stream ? '正在重新連線 · 保留上次資料' : '已取得快照'});
            succeeded = true;
          } catch (error) {
            if (!active()) return false;
            patch({error: errorText(error), status: stream ? '快照更新失敗' : '連線失敗'});
            succeeded = false;
          }
        } while (dirty && active());
      } finally {refreshing = false;}
      return succeeded;
    }
    if (!await refresh() || !active()) return;
    try {
      const es = transport.eventSource(runUrl(chosen.run, chosen.tester, '/events'));
      stream = es;
      const update = () => {if (active()) void refresh();};
      es.addEventListener('ready', () => {
        if (!active()) return;
        connected = true;
        // A ready event proves transport recovery, not snapshot recovery.
        if (!state.error) patch({status: '事件流已連線'});
        update();
      });
      es.addEventListener('edge_event', update);
      es.addEventListener('heartbeat', update);
      es.addEventListener('stream_error', () => {
        if (!active()) return;
        connected = false; patch({status: '事件流中斷 · 等待重連'});
      });
      es.onerror = () => {
        if (!active()) return;
        connected = false; patch({status: '正在重新連線 · 保留上次資料'});
      };
    } catch (error) {if (active()) patch({error: errorText(error), status: '連線失敗'});}
  }
  async function ask(question: string) {
    if (disposed || !state.scope || !question.trim() || state.busy) return;
    const g = generation, c = ++chatGeneration, scope = state.scope;
    const active = () => !disposed && generation === g && chatGeneration === c;
    const ctrl = new AbortController(); chatCancel = ctrl;
    const text = question.trim(), incident = dashboardEvidence(state).current?.incident_id;
    const history = state.messages.slice(-10).map(m => ({role: m.role, content: m.text}));
    patch({busy: true, chatError: '', question: ''});
    try {
      const response = await transport.fetch(runUrl(scope.run, scope.tester, '/chat'), {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: ctrl.signal,
        body: JSON.stringify({mode: 'openai', question: text, tester_id: scope.tester, incident_id: incident, history}),
      });
      const payload = await response.json();
      if (!active()) return;
      if (!response.ok) throw Error(responseError(payload, 'AI 調查失敗'));
      const body = answerSchema.parse(payload);
      patch({messages: [...state.messages, {role: 'user', text}, {role: 'assistant', text: body.answer, refs: body.evidence_ids, id: body.investigation_id ?? undefined}]});
    } catch (error) {if (active()) patch({chatError: errorText(error), question: text});}
    finally {if (active()) patch({busy: false});}
  }
  return {
    connect, ask,
    getState: () => state,
    setQuestion: (question: string) => patch({question}),
    setSearch: (search: string) => {if (disposed) return; resetChat(); patch({search, selected: ''});},
    selectEvidence: (selected: string, citation = false) => {
      if (disposed) return;
      if (citation) {cancelChat(); patch({busy: false, chatError: '', question: ''});}
      else resetChat();
      patch({selected});
    },
    disconnect: () => {if (disposed) return; stop(); patch({busy: false, status: '已中斷 · 保留上次資料'});},
    dispose: () => {disposed = true; stop();},
  };
}
