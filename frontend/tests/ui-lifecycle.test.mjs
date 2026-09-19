import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardLifecycle, dashboardEvidence} from '../lib/rtdi/ui-lifecycle.ts';
import {CONVERSATION_SESSION_KEY} from '../lib/rtdi/ui-conversations.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function fixture(run = 'r1', tester = 't1', label = 'first') {
  const event = {event_id: label, type: 'heartbeat', source_mode: 'replay', run_id: run, tester_id: tester, timestamp: '2026-09-19T00:00:00Z', evidence_id: `evidence-${label}`, incident_id: `incident-${label}`};
  return {
    run: {run_id: run, tester_id: tester, edge_id: 'edge', mode: 'replay', lot_id: null, wafer_id: null, data_quality: 'partial', last_event_at: event.timestamp},
    events: [event], evidence: [event], incidents: [],
    commands: [{command_id: `command-${label}`, run_id: run, tester_id: tester, incident_id: event.incident_id, kind: 'show_message', message: label, status: 'queued', expires_at: 'x', created_at: 'x', updated_at: 'x'}],
  };
}
function harness(options) {
  const requests = [], streams = [], states = [];
  const lifecycle = createDashboardLifecycle({
    fetch(url, options) {
      const result = deferred();
      // Deliberately do not listen to AbortSignal. Even a late body can arrive.
      requests.push({url, options, ...result, respond(payload, status = 200) {result.resolve({ok: status < 400, status, json: async () => payload});}});
      return result.promise;
    },
    eventSource(url) {
      const handlers = new Map();
      const stream = {url, closed: false, onerror: null, addEventListener(type, listener) {handlers.set(type, listener);}, close() {this.closed = true;}, emit(type) {if (type === 'error') this.onerror?.(); else handlers.get(type)?.();}};
      streams.push(stream); return stream;
    },
  }, state => states.push(state), options);
  return {lifecycle, requests, streams, states, state: () => lifecycle.getState(), async load(run = 'r1', tester = 't1') {
    const pending = lifecycle.connect(run, tester); requests.at(-1).respond(fixture(run, tester)); await pending;
  }};
}

test('switching run or tester ignores late snapshots and late JSON bodies, even without abort support', async () => {
  for (const [run, tester] of [['r2', 't1'], ['r1', 't2']]) {
    const h = harness(), first = h.lifecycle.connect('r1', 't1');
    const body = deferred(); h.requests[0].resolve({ok: true, json: () => body.promise}); await tick();
    const second = h.lifecycle.connect(run, tester);
    assert.equal(h.requests[0].options.signal.aborted, true);
    h.requests[1].respond(fixture(run, tester, 'new')); await second;
    body.resolve(fixture('r1', 't1', 'old')); await first;
    assert.equal(h.state().data.commands[0].command_id, 'command-new');
    assert.deepEqual(h.state().scope, {run, tester});
    assert.equal(h.streams.length, 1);
    assert.equal(h.state().error, '');
  }
});

test('new scope clears data, citations, errors and draft before a failed or ambiguous lookup', async () => {
  for (const status of [404, 409]) {
    const h = harness(); await h.load();
    const chat = h.lifecycle.ask('old question'); h.requests.at(-1).respond({answer: 'persisted', evidence_ids: ['evidence-first'], investigation_id: 'saved-id'}); await chat;
    h.lifecycle.setQuestion('old draft');
    const lookup = h.lifecycle.connect('r2', '');
    assert.equal(h.state().data, null); assert.equal(h.state().scope, null);
    assert.deepEqual(h.state().messages, []); assert.equal(h.state().question, '');
    h.requests.at(-1).respond({error: 'lookup failed'}, status); await lookup;
    assert.equal(h.state().error, 'lookup failed'); assert.equal(h.state().data, null);
    assert.equal(h.streams.length, 1); assert.equal(h.streams[0].closed, true);
    const count = h.requests.length; await h.lifecycle.ask('cannot investigate unresolved scope'); assert.equal(h.requests.length, count);
  }
});

test('blank tester resolves once and all refresh/chat URLs bind to the returned tester', async () => {
  const h = harness(), connect = h.lifecycle.connect('r1', '');
  h.requests[0].respond(fixture()); await connect;
  assert.equal(h.streams[0].url, '/api/v1/runs/r1/events?tester_id=t1');
  h.streams[0].emit('ready'); assert.equal(h.requests[1].url, '/api/v1/runs/r1?tester_id=t1');
  h.requests[1].respond(fixture()); await tick();
  const chat = h.lifecycle.ask('why'); assert.equal(h.requests[2].url, '/api/v1/runs/r1/chat?tester_id=t1');
  assert.deepEqual(JSON.parse(h.requests[2].options.body), {mode: 'openai', language: 'en', question: 'why', tester_id: 't1', incident_id: 'incident-first', history: []});
  h.requests[2].respond({answer: 'answer', evidence_ids: ['evidence-first'], investigation_id: 'id'}); await chat;
  assert.deepEqual(h.state().messages[1], {role: 'assistant', text: 'answer', refs: ['evidence-first'], id: 'id'});
  const retry = h.lifecycle.connect('r1', ''); assert.equal(h.state().data, null, 'unqualified lookup must not assume previous tester is still unique');
  h.requests.at(-1).respond({error: 'ambiguous'}, 409); await retry;
});

test('same-scope reconnect retains last good snapshot; disconnect blocks queued stream work and late refresh', async () => {
  const h = harness(); await h.load(); const original = h.state().data;
  h.streams[0].emit('edge_event'); const pending = h.requests.at(-1);
  h.lifecycle.disconnect(); const count = h.requests.length;
  h.streams[0].emit('heartbeat'); h.streams[0].emit('ready'); h.streams[0].emit('error');
  assert.equal(h.requests.length, count); assert.equal(pending.options.signal.aborted, true);
  pending.respond(fixture('r1', 't1', 'late')); await tick();
  assert.equal(h.state().data, original); assert.equal(h.state().status, 'Disconnected · Showing last snapshot');
  const reconnect = h.lifecycle.connect(' r1 ', ' t1 '); assert.equal(h.state().data, original);
  h.requests.at(-1).respond({error: 'temporary'}, 503); await reconnect;
  assert.equal(h.state().data, original); assert.equal(h.state().error, 'temporary');
  const success = h.lifecycle.connect('r1', 't1'); h.requests.at(-1).respond(fixture('r1', 't1', 'recovered')); await success;
  assert.equal(h.state().data.commands[0].message, 'recovered'); assert.equal(h.state().error, '');
});

test('SSE bursts serialize and coalesce refreshes, including a dirty retry after failure', async () => {
  const h = harness(); await h.load(); const es = h.streams[0];
  es.emit('ready'); for (let i = 0; i < 20; i++) es.emit('edge_event');
  assert.equal(h.requests.length, 2);
  h.requests[1].respond({error: 'temporary'}, 503); await tick();
  assert.equal(h.requests.length, 3); assert.equal(h.state().error, 'temporary');
  h.requests[2].respond(fixture('r1', 't1', 'latest')); await tick();
  assert.equal(h.requests.length, 3); assert.equal(h.state().error, ''); assert.equal(h.state().status, 'Event stream connected');
  assert.equal(h.state().data.commands[0].message, 'latest');
});

test('ready does not erase snapshot errors; successful refresh clears error and reflects current stream state', async () => {
  const h = harness(); await h.load(); const es = h.streams[0];
  es.emit('edge_event'); h.requests.at(-1).respond({error: 'read failed'}, 500); await tick();
  es.emit('error'); es.emit('ready'); assert.equal(h.state().error, 'read failed');
  es.emit('stream_error'); h.requests.at(-1).respond(fixture()); await tick();
  assert.equal(h.state().error, ''); assert.match(h.state().status, /Reconnecting/);
  es.emit('ready'); h.requests.at(-1).respond(fixture()); await tick(); assert.equal(h.state().status, 'Event stream connected');
});

test('late chat success/error/finally cannot overwrite the new scope or release its busy state', async () => {
  for (const fail of [false, true]) {
    const h = harness(); await h.load(); const old = h.lifecycle.ask('old'); const oldRequest = h.requests.at(-1);
    await h.load('r1', 't2'); const next = h.lifecycle.ask('new'); const nextRequest = h.requests.at(-1);
    if (fail) oldRequest.reject(Error('old error')); else oldRequest.respond({answer: 'old', evidence_ids: ['old-citation']});
    await old;
    assert.equal(h.state().busy, true); assert.deepEqual(h.state().messages, []); assert.equal(h.state().chatError, ''); assert.equal(h.state().question, '');
    nextRequest.respond({answer: 'new', evidence_ids: ['new-citation'], investigation_id: 'new-id'}); await next;
    assert.equal(h.state().busy, false); assert.deepEqual(h.state().messages[1].refs, ['new-citation']);
  }
});

test('disconnect and same-scope reconnect reject pending AI without destroying saved answers', async () => {
  const h = harness(); await h.load();
  const saved = h.lifecycle.ask('saved'); h.requests.at(-1).respond({answer: 'saved', investigation_id: 'saved-id'}); await saved;
  const late = h.lifecycle.ask('late'); const request = h.requests.at(-1);
  h.lifecycle.disconnect(); const retry = h.lifecycle.connect('r1', 't1');
  h.requests.at(-1).respond(fixture()); await retry;
  request.respond({answer: 'late', evidence_ids: ['bad']}); await late;
  assert.equal(h.state().messages.length, 2); assert.equal(h.state().messages[1].id, 'saved-id'); assert.equal(h.state().busy, false);
});

test('new evidence preserves selected incident; removed evidence or citation navigation invalidates in-flight AI', async () => {
  const h = harness(); await h.load(); const pending = h.lifecycle.ask('first'); const request = h.requests.at(-1);
  h.streams[0].emit('heartbeat'); const added = fixture('r1', 't1', 'second'); added.evidence.push(fixture().evidence[0]);
  h.requests.at(-1).respond(added); await tick(); assert.equal(dashboardEvidence(h.state()).current.event_id, 'first'); assert.equal(h.state().busy, true);
  h.lifecycle.selectEvidence('second', true); assert.equal(request.options.signal.aborted, true);
  request.respond({answer: 'wrong incident'}); await pending; assert.deepEqual(h.state().messages, []);
  const removed = h.lifecycle.ask('second'); const removedRequest = h.requests.at(-1);
  h.streams[0].emit('heartbeat'); h.requests.at(-1).respond(fixture()); await tick();
  removedRequest.respond({answer: 'removed'}); await removed;
  assert.equal(dashboardEvidence(h.state()).current.event_id, 'first'); assert.deepEqual(h.state().messages, []);
});

test('late snapshot errors cannot replace new scope errors', async () => {
  const h = harness(), first = h.lifecycle.connect('old', 't1'); const request = h.requests[0];
  const next = h.lifecycle.connect('new', 't2'); h.requests[1].respond({error: 'new failure'}, 404); await next;
  request.reject(Error('old failure')); await first; assert.equal(h.state().error, 'new failure');
});

test('unmount aborts resources and ignores late responses, errors and closed-stream events', async () => {
  const h = harness(); await h.load();
  h.streams[0].emit('heartbeat'); const snapshot = h.requests.at(-1);
  const chat = h.lifecycle.ask('pending'); const request = h.requests.at(-1);
  h.lifecycle.dispose(); const count = h.states.length, requests = h.requests.length;
  snapshot.respond(fixture('r1', 't1', 'late')); request.reject(Error('late')); await chat; await tick();
  h.streams[0].emit('ready'); h.streams[0].emit('error'); await h.lifecycle.connect('new', 'tester'); await h.lifecycle.ask('ignored');
  assert.equal(h.states.length, count); assert.equal(h.requests.length, requests);
  assert.equal(h.streams[0].closed, true); assert.equal(snapshot.options.signal.aborted, true); assert.equal(request.options.signal.aborted, true);
});

function memoryStorage() {
  const values = new Map();
  return {values, writes: 0, getItem(key) {return values.get(key) ?? null;}, setItem(key, value) {this.writes++; values.set(key, value);}};
}
function multipleEvidence(run = 'r1', tester = 't1') {
  const data = fixture(run, tester);
  data.evidence.push({...data.evidence[0], event_id: 'sibling', evidence_id: 'evidence-sibling'});
  data.evidence.push(fixture(run, tester, 'second').evidence[0]);
  return data;
}
async function loadEvidence(h, data = multipleEvidence()) {
  const pending = h.lifecycle.connect(data.run.run_id, data.run.tester_id);
  h.requests.at(-1).respond(data); await pending;
}
async function answer(h, question = 'why', text = 'saved answer') {
  const pending = h.lifecycle.ask(question);
  h.requests.at(-1).respond({answer: text, evidence_ids: ['evidence-first'], investigation_id: 'saved-investigation'});
  await pending;
}

test('search and same-evidence selection preserve conversation, draft and pending request', async () => {
  const h = harness(); await loadEvidence(h); await answer(h);
  h.lifecycle.setQuestion('draft');
  h.lifecycle.setSearch('no matching evidence');
  assert.equal(dashboardEvidence(h.state()).filtered.length, 0);
  assert.equal(dashboardEvidence(h.state()).current.event_id, 'first');
  assert.equal(h.state().messages.length, 2); assert.equal(h.state().question, 'draft');
  const pending = h.lifecycle.ask('next'), request = h.requests.at(-1);
  h.lifecycle.setSearch('heartbeat'); h.lifecycle.selectEvidence('first');
  assert.equal(h.state().busy, true); assert.equal(request.options.signal.aborted, false);
  h.lifecycle.selectEvidence('unknown citation', true);
  assert.equal(h.state().selected, 'first'); assert.equal(h.state().busy, true);
  request.respond({answer: 'next answer'}); await pending;
  assert.equal(h.state().messages.length, 4);
});

test('same-incident evidence keeps history and draft but cancels an investigation tied to the previous evidence', async () => {
  const h = harness(); await loadEvidence(h); await answer(h);
  h.lifecycle.setQuestion('retained draft'); h.lifecycle.selectEvidence('sibling');
  assert.equal(h.state().question, 'retained draft'); assert.equal(h.state().messages.length, 2);
  const pending = h.lifecycle.ask('interrupted question'), request = h.requests.at(-1);
  h.lifecycle.selectEvidence('first', true);
  assert.equal(request.options.signal.aborted, true); assert.equal(h.state().busy, false);
  assert.equal(h.state().question, 'interrupted question');
  request.respond({answer: 'late answer'}); await pending;
  assert.equal(h.state().messages.length, 2); assert.equal(h.state().question, 'interrupted question');
});

test('incident and citation navigation restore separate histories and submit only destination history', async () => {
  const h = harness(); await loadEvidence(h); await answer(h, 'first question', 'first answer');
  h.lifecycle.setQuestion('first draft'); h.lifecycle.selectEvidence('second', true);
  assert.deepEqual(h.state().messages, []); assert.equal(h.state().question, '');
  const pending = h.lifecycle.ask('second question');
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body).history, []);
  assert.equal(JSON.parse(h.requests.at(-1).options.body).incident_id, 'incident-second');
  h.requests.at(-1).respond({answer: 'second answer'}); await pending;
  h.lifecycle.setQuestion('second draft'); h.lifecycle.selectEvidence('first', true);
  assert.equal(h.state().question, 'first draft'); assert.equal(h.state().messages[1].text, 'first answer');
  const followup = h.lifecycle.ask('first followup');
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body).history, [{role: 'user', content: 'first question'}, {role: 'assistant', content: 'first answer'}]);
  h.requests.at(-1).respond({answer: 'first followup answer'}); await followup;
  h.lifecycle.selectEvidence('second');
  assert.equal(h.state().messages.length, 2); assert.equal(h.state().messages[1].text, 'second answer');
  assert.equal(h.state().question, 'second draft');
});

test('identical incident IDs stay isolated by resolved run and tester, including unqualified lookup', async () => {
  const h = harness(); await h.load(); await answer(h, 'original', 'original answer');
  h.lifecycle.setQuestion('original draft');
  for (const [run, tester] of [['r2', 't1'], ['r1', 't2']]) {
    await h.load(run, tester); assert.deepEqual(h.state().messages, []);
    await answer(h, tester, run + tester);
  }
  const pending = h.lifecycle.connect('r1', '');
  assert.deepEqual(h.state().messages, []); assert.equal(h.state().scope, null);
  h.requests.at(-1).respond(fixture()); await pending;
  assert.equal(h.state().messages[1].text, 'original answer'); assert.equal(h.state().question, 'original draft');
  await h.load('r1', 't2'); assert.equal(h.state().messages[1].text, 'r1t2');
});

test('evidence without an incident gets event-specific history separate from run-summary chat', async () => {
  const h = harness(), data = multipleEvidence();
  for (const event of data.evidence) delete event.incident_id;
  await loadEvidence(h, data); await answer(h, 'event first');
  h.lifecycle.selectEvidence('sibling'); assert.deepEqual(h.state().messages, []);
  const pending = h.lifecycle.ask('event sibling');
  assert.equal(JSON.parse(h.requests.at(-1).options.body).incident_id, undefined);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body).history, []);
  h.requests.at(-1).respond({answer: 'sibling answer'}); await pending;
  h.lifecycle.selectEvidence('first'); assert.equal(h.state().messages[0].text, 'event first');
  const empty = {...data, evidence: []};
  h.streams[0].emit('heartbeat'); h.requests.at(-1).respond(empty); await tick();
  assert.deepEqual(h.state().messages, []); await answer(h, 'run question', 'run answer');
  h.streams[0].emit('heartbeat'); h.requests.at(-1).respond(data); await tick();
  assert.equal(h.state().messages[0].text, 'event first');
  h.streams[0].emit('heartbeat'); h.requests.at(-1).respond(empty); await tick();
  assert.equal(h.state().messages[1].text, 'run answer');
});

test('route remount restores selected evidence, exact scope, messages, references and drafts after a fresh snapshot', async () => {
  const storage = memoryStorage(), h = harness({conversationStorage: storage});
  await loadEvidence(h); await answer(h); h.lifecycle.setQuestion('first draft');
  h.lifecycle.selectEvidence('second'); await answer(h, 'second question', 'second answer');
  h.lifecycle.setQuestion('second draft'); h.lifecycle.dispose();
  const remount = harness({conversationStorage: storage});
  assert.deepEqual(remount.state().messages, []);
  const restore = remount.lifecycle.restoreSession();
  assert.equal(remount.requests[0].url, '/api/v1/runs/r1?tester_id=t1');
  assert.equal(remount.state().data, null); assert.deepEqual(remount.state().messages, []);
  remount.requests[0].respond(multipleEvidence()); await restore;
  assert.equal(remount.state().selected, 'second'); assert.equal(remount.state().question, 'second draft');
  assert.equal(remount.state().messages[1].text, 'second answer'); assert.equal(remount.state().busy, false);
  remount.lifecycle.selectEvidence('first');
  assert.equal(remount.state().question, 'first draft');
  assert.deepEqual(remount.state().messages[1], {role: 'assistant', text: 'saved answer', refs: ['evidence-first'], id: 'saved-investigation'});
  const count = remount.requests.length; await remount.lifecycle.restoreSession(); assert.equal(remount.requests.length, count);
});

test('failed, ambiguous and mismatched restored snapshots never expose cached scope or history', async () => {
  const storage = memoryStorage(), h = harness({conversationStorage: storage});
  await h.load(); await answer(h); h.lifecycle.dispose();
  for (const [payload, status] of [[{error: 'missing'}, 404], [{error: 'ambiguous'}, 409], [fixture('r1', 'wrong-tester'), 200]]) {
    const next = harness({conversationStorage: storage}), restore = next.lifecycle.restoreSession();
    next.requests[0].respond(payload, status); await restore;
    assert.equal(next.state().scope, null); assert.equal(next.state().data, null);
    assert.deepEqual(next.state().messages, []); assert.notEqual(next.state().error, '');
    assert.equal(next.streams.length, 0);
    await next.lifecycle.ask('unresolved'); assert.equal(next.requests.length, 1);
    next.lifecycle.dispose();
  }
  const next = harness({conversationStorage: storage});
  await next.load(); assert.equal(next.state().messages.length, 2, 'failed restores do not erase the saved conversation');
});

test('manual connection wins over a pending session restore and stale restored JSON', async () => {
  const storage = memoryStorage(), h = harness({conversationStorage: storage});
  await h.load(); await answer(h); h.lifecycle.dispose();
  const next = harness({conversationStorage: storage}), restore = next.lifecycle.restoreSession();
  const body = deferred(); next.requests[0].resolve({ok: true, json: () => body.promise}); await tick();
  await next.load('r2', 't2'); body.resolve(fixture()); await restore;
  assert.deepEqual(next.state().scope, {run: 'r2', tester: 't2'}); assert.deepEqual(next.state().messages, []);
  assert.equal(next.streams.length, 1);
  const count = next.requests.length; await next.lifecycle.restoreSession(); assert.equal(next.requests.length, count);
});

test('corrupt, unsupported and denied session storage fall back to working in-memory conversations', async () => {
  for (const raw of ['{broken', JSON.stringify({version: 2}), JSON.stringify({version: 1, lastScope: {run: 'r1', tester: ''}, selections: [], conversations: []}), 'x'.repeat(2_000_001)]) {
    const storage = memoryStorage(); storage.values.set(CONVERSATION_SESSION_KEY, raw);
    const h = harness({conversationStorage: storage}); await h.lifecycle.restoreSession();
    assert.equal(h.requests.length, 0); await loadEvidence(h); await answer(h);
    h.lifecycle.selectEvidence('second'); h.lifecycle.selectEvidence('first'); assert.equal(h.state().messages.length, 2);
  }
  const h = harness({conversationStorage: {getItem() {throw Error('storage denied');}, setItem() {throw Error('quota exceeded');}}});
  await h.lifecycle.restoreSession(); await loadEvidence(h); await answer(h);
  h.lifecycle.setQuestion('still works'); h.lifecycle.selectEvidence('second'); h.lifecycle.selectEvidence('first');
  assert.equal(h.state().messages.length, 2); assert.equal(h.state().question, 'still works'); assert.equal(h.state().chatError, '');
});

test('late chat bodies and errors cannot contaminate destination state or its persisted session', async () => {
  for (const fail of [false, true]) {
    const storage = memoryStorage(), h = harness({conversationStorage: storage});
    await loadEvidence(h); await answer(h);
    const old = h.lifecycle.ask('retry old'), request = h.requests.at(-1), body = deferred();
    if (!fail) {request.resolve({ok: true, json: () => body.promise}); await tick();}
    h.lifecycle.selectEvidence('second'); const next = h.lifecycle.ask('new question'), nextRequest = h.requests.at(-1);
    const saved = storage.getItem(CONVERSATION_SESSION_KEY), writes = storage.writes;
    if (fail) request.reject(Error('old error')); else body.resolve({answer: 'stale answer'});
    await old;
    assert.equal(storage.getItem(CONVERSATION_SESSION_KEY), saved); assert.equal(storage.writes, writes);
    assert.equal(h.state().busy, true); assert.equal(h.state().chatError, ''); assert.deepEqual(h.state().messages, []);
    nextRequest.respond({answer: 'new answer'}); await next;
    h.lifecycle.selectEvidence('first'); assert.equal(h.state().messages.length, 2); assert.equal(h.state().question, 'retry old');
  }
});

test('disposing during AI preserves a retryable draft without resurrecting pending work or persisting late success', async () => {
  const storage = memoryStorage(), h = harness({conversationStorage: storage});
  await h.load(); await answer(h);
  const pending = h.lifecycle.ask('retry on return'), request = h.requests.at(-1);
  h.lifecycle.dispose(); const saved = storage.getItem(CONVERSATION_SESSION_KEY), writes = storage.writes;
  request.respond({answer: 'late answer'}); await pending;
  h.lifecycle.setQuestion('ignored'); h.lifecycle.setSearch('ignored'); h.lifecycle.selectEvidence('first'); h.lifecycle.dispose();
  assert.equal(storage.getItem(CONVERSATION_SESSION_KEY), saved); assert.equal(storage.writes, writes);
  const remount = harness({conversationStorage: storage}), restore = remount.lifecycle.restoreSession();
  remount.requests[0].respond(fixture()); await restore;
  assert.equal(remount.state().messages.length, 2); assert.equal(remount.state().question, 'retry on return');
  assert.equal(remount.state().busy, false); assert.equal(remount.state().chatError, ''); assert.equal(remount.requests.length, 1);
});

test('snapshot removal keeps same-incident history, while reassignment isolates a changed incident on the same event', async () => {
  const h = harness(); await loadEvidence(h); await answer(h);
  const pending = h.lifecycle.ask('cancel on removal'), request = h.requests.at(-1);
  const removed = multipleEvidence(); removed.evidence.shift();
  h.streams[0].emit('heartbeat'); h.requests.at(-1).respond(removed); await tick();
  assert.equal(h.state().selected, 'sibling'); assert.equal(h.state().messages.length, 2);
  assert.equal(h.state().question, 'cancel on removal'); assert.equal(request.options.signal.aborted, true);
  request.respond({answer: 'removed evidence answer'}); await pending;
  removed.evidence[0].incident_id = 'new-incident';
  h.streams[0].emit('heartbeat'); h.requests.at(-1).respond(removed); await tick();
  assert.deepEqual(h.state().messages, []); assert.equal(h.state().question, '');
  h.streams[0].emit('heartbeat'); h.requests.at(-1).respond(multipleEvidence()); await tick();
  assert.equal(h.state().selected, 'sibling'); assert.equal(h.state().messages.length, 2);
});


test('analysis forwards the selected language and preserves separate local references', async () => {
  const h = harness(); await loadEvidence(h);
  const pending = h.lifecycle.ask('Explain this result.', 'zh-TW');
  const request = h.requests.at(-1);
  assert.equal(JSON.parse(request.options.body).language, 'zh-TW');
  request.respond({ answer: '平均值偏移。[evidence-first] [KB-statistics]', evidence_ids: ['evidence-first'], knowledge_sources: [{ id: 'KB-statistics' }], investigation_id: 'saved' });
  await pending;
  assert.deepEqual(h.state().messages[1].knowledgeRefs, ['KB-statistics']);
  assert.deepEqual(h.state().messages[1].refs, ['evidence-first']);
  h.lifecycle.selectEvidence('second'); h.lifecycle.selectEvidence('first');
  assert.deepEqual(h.state().messages[1].knowledgeRefs, ['KB-statistics']);
  h.lifecycle.dispose();
});
