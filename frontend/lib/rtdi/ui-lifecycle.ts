import {z} from 'zod';
import {createRunNotifications, type RunNotification} from './ui-notifications.ts';
import {parseSnapshot, runUrl, type Snapshot} from './dashboard.ts';
import {conversationKey, createConversationCache, type ConversationContext, type ConversationMessage, type ConversationScope, type ConversationStorage} from './ui-conversations.ts';

type Scope = ConversationScope;
type Message = ConversationMessage;
export type DashboardLifecycleOptions = {conversationStorage?: ConversationStorage};
export type DashboardState = {
  scope: Scope | null; data: Snapshot | null; status: string; error: string;
  selected: string; search: string; question: string; busy: boolean;
  chatError: string; messages: Message[];
  notifications: RunNotification[];
};
export const initialDashboardState = (): DashboardState => ({
  scope: null, data: null, status: 'Not connected', error: '', selected: '', search: '',
  question: '', busy: false, chatError: '', messages: [], notifications: [],
});
export function dashboardEvidence(state: DashboardState) {
  const evidence = state.data?.evidence ?? [];
  const filtered = evidence.filter(e => `${e.kind} ${e.wafer_id} ${e.message} ${e.test_name} ${e.affected_tests?.join(' ')}`.toLowerCase().includes(state.search.toLowerCase()));
  return {evidence, filtered, current: evidence.find(e => e.event_id === state.selected) ?? evidence[0]};
}
type Stream = {addEventListener(type: string, listener: () => void): void; onerror: EventSource['onerror']; close(): void};
type Transport = {fetch: typeof fetch; eventSource: (url: string) => Stream};
const errorText = (value: unknown) => value instanceof Error ? value.message : 'Request failed';
const responseError = (payload: unknown, fallback: string) => z.object({error: z.string()}).safeParse(payload).data?.error ?? fallback;
const answerSchema = z.object({answer: z.string(), evidence_ids: z.array(z.string()).optional(), investigation_id: z.string().nullable().optional(), knowledge_sources: z.array(z.object({id: z.string()})).optional()});

/** The page and deferred-transport tests use this same lifecycle. Abort is only
 * resource cleanup: generation checks also reject transports that ignore it. */
export function createDashboardLifecycle(transport: Transport, publish: (state: DashboardState) => void, options: DashboardLifecycleOptions = {}) {
  let state = initialDashboardState();
  const conversations = createConversationCache(options.conversationStorage);
  let pendingQuestion = '';
  let connectionScope: Scope | null = null;
  let generation = 0, chatGeneration = 0, disposed = false;
  let cancel: AbortController | undefined, chatCancel: AbortController | undefined, stream: Stream | undefined;
  const patch = (update: Partial<DashboardState>) => {
    if (disposed) return;
    state = {...state, ...update};
    publish(state);
  };
  const notifications = createRunNotifications(items => patch({notifications: items}));
  const cancelChat = () => {
    chatGeneration++; chatCancel?.abort();
    state = {...state, busy: false, question: state.question || pendingQuestion};
    pendingQuestion = '';
  };
  const stop = () => {generation++; connectionScope = null; cancel?.abort(); stream?.close(); stream = undefined; cancelChat(); notifications.reset();};
  const context = (value: DashboardState): ConversationContext => {
    const current = dashboardEvidence(value).current;
    return current?.incident_id ? ['incident', current.incident_id]
      : current ? ['event', current.event_id] : ['run', ''];
  };
  const key = (value: DashboardState) => value.scope ? conversationKey(value.scope, context(value)) : null;
  const remember = () => {
    if (disposed || !state.scope) return;
    conversations.write(state.scope, context(state), {messages: state.messages, question: state.question || pendingQuestion}, state.selected);
  };
  function transition(update: Partial<DashboardState>) {
    const next = {...state, ...update};
    const changedConversation = key(state) !== key(next);
    const changedEvidence = dashboardEvidence(state).current?.event_id !== dashboardEvidence(next).current?.event_id;
    if (changedConversation || changedEvidence) {
      remember();
      cancelChat();
      const restored = changedConversation && next.scope ? conversations.read(next.scope, context(next)) : {};
      // Publish destination evidence and its own history together, never a frame
      // containing evidence from one incident and messages from another.
      patch({...update, ...restored, busy: false, chatError: ''});
    } else patch(update);
    remember();
  };
  function acceptSnapshot(data: Snapshot, scope: Scope) {
    // Pin the visible evidence so inserting a newer item cannot silently change
    // the incident while an investigation is pending.
    const sameScope = state.scope?.run === scope.run && state.scope.tester === scope.tester;
    const next = {...state, data, scope, selected: sameScope ? state.selected : conversations.selected(scope)};
    const selected = dashboardEvidence(next).current?.event_id ?? '';
    transition({data, scope, selected});
  }
  async function connect(run: string, tester: string) {
    if (disposed || !run.trim()) return;
    const chosen = {run: run.trim(), tester: tester.trim()};
    const sameScope = state.scope?.run === chosen.run && state.scope.tester === chosen.tester;
    remember(); stop();
    connectionScope = chosen;
    const g = generation, active = () => !disposed && generation === g;
    const ctrl = new AbortController(); cancel = ctrl;
    patch({...(sameScope ? {} : initialDashboardState()), busy: false, chatError: '',
      error: '', status: sameScope ? 'Reconnecting · Showing last snapshot' : 'Connecting'});
    let refreshing = false, dirty = false, connected = false;
    let notificationEpoch = 0;
    const resetNotifications = () => {notificationEpoch++; notifications.reset();};
    async function refresh() {
      if (!active()) return false;
      if (refreshing) {dirty = true; return false;}
      refreshing = true;
      let succeeded = false;
      try {
        do {
          dirty = false;
          const epoch = notificationEpoch;
          try {
            const response = await transport.fetch(runUrl(chosen.run, chosen.tester), {signal: ctrl.signal, cache: 'no-store'});
            const payload = await response.json();
            if (!active()) return false;
            if (!response.ok) throw Error(responseError(payload, `Request failed (${response.status})`));
            const data = parseSnapshot(payload, chosen.run, chosen.tester);
            chosen.tester = data.run.tester_id;
            acceptSnapshot(data, {...chosen});
            if (epoch === notificationEpoch) notifications.accept(data, connected);
            patch({error: '', status: connected ? 'Event stream connected' : stream ? 'Reconnecting · Showing last snapshot' : 'Snapshot loaded'});
            succeeded = true;
          } catch (error) {
            if (!active()) return false;
            resetNotifications();
            patch({error: errorText(error), status: stream ? 'Snapshot refresh failed' : 'Connection failed'});
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
        resetNotifications();
        // A ready event proves transport recovery, not snapshot recovery.
        if (!state.error) patch({status: 'Event stream connected'});
        update();
      });
      es.addEventListener('edge_event', update);
      es.addEventListener('heartbeat', update);
      es.addEventListener('stream_error', () => {
        if (!active()) return;
        connected = false; resetNotifications(); patch({status: 'Event stream interrupted · Waiting to reconnect'});
      });
      es.onerror = () => {
        if (!active()) return;
        connected = false; resetNotifications(); patch({status: 'Reconnecting · Showing last snapshot'});
      };
    } catch (error) {if (active()) patch({error: errorText(error), status: 'Connection failed'});}
  }
  async function ask(question: string, language: "en" | "zh-TW" = "en") {
    if (disposed || !state.scope || !question.trim() || state.busy) return;
    const g = generation, c = ++chatGeneration, scope = state.scope;
    const active = () => !disposed && generation === g && chatGeneration === c;
    const ctrl = new AbortController(); chatCancel = ctrl;
    const text = question.trim(), incident = dashboardEvidence(state).current?.incident_id;
    const history = state.messages.slice(-10).map(m => ({role: m.role, content: m.text.slice(0, 5000)}));
    pendingQuestion = text;
    patch({busy: true, chatError: '', question: ''});
    remember();
    try {
      const response = await transport.fetch(runUrl(scope.run, scope.tester, '/chat'), {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: ctrl.signal,
        body: JSON.stringify({mode: 'openai', language, question: text, tester_id: scope.tester, incident_id: incident, history}),
      });
      const payload = await response.json();
      if (!active()) return;
      if (!response.ok) throw Error(responseError(payload, 'AI investigation failed'));
      const body = answerSchema.parse(payload);
      pendingQuestion = '';
      patch({messages: [...state.messages, {role: 'user', text}, {role: 'assistant', text: body.answer, refs: body.evidence_ids, ...(body.knowledge_sources?.length ? {knowledgeRefs: body.knowledge_sources.map(source => source.id)} : {}), id: body.investigation_id ?? undefined}]});
    } catch (error) {if (active()) patch({chatError: errorText(error), question: state.question || text});}
    finally {if (active()) {pendingQuestion = ''; patch({busy: false}); remember();}}
  }
  return {
    connect, ask,
    forgetRun: (scope: Scope) => {
      if (disposed) {conversations.forget(scope); return;}
      const matches = (candidate: Scope | null) => candidate?.run === scope.run && candidate.tester === scope.tester;
      if (matches(state.scope) || matches(connectionScope) ||
          (connectionScope?.run === scope.run && !connectionScope.tester)) {
        stop();
        patch(initialDashboardState());
      }
      conversations.forget(scope);
    },
    dismissNotification: (id: number) => {if (!disposed) notifications.dismiss(id);},
    restoreSession: async () => {
      // A manual connection or an earlier restore takes precedence. Never
      // expose saved history until the backend validates the resolved scope.
      const scope = conversations.lastScope();
      if (!disposed && generation === 0 && scope) await connect(scope.run, scope.tester);
    },
    getState: () => state,
    setQuestion: (question: string) => {if (disposed) return; patch({question}); remember();},
    setSearch: (search: string) => {if (!disposed) patch({search});},
    selectEvidence: (selected: string, _citation = false) => {
      if (disposed || !state.data?.evidence.some(e => e.event_id === selected)) return;
      transition({selected});
    },
    disconnect: () => {if (disposed) return; remember(); stop(); patch({busy: false, status: 'Disconnected · Showing last snapshot'});},
    dispose: () => {if (disposed) return; remember(); disposed = true; stop();},
  };
}
