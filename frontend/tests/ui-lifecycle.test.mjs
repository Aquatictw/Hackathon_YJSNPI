import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardLifecycle, dashboardEvidence} from '../lib/rtdi/ui-lifecycle.ts';

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
function harness() {
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
  }, state => states.push(state));
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
  assert.deepEqual(JSON.parse(h.requests[2].options.body), {mode: 'openai', question: 'why', tester_id: 't1', incident_id: 'incident-first', history: []});
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
  assert.equal(h.state().data, original); assert.equal(h.state().status, '已中斷 · 保留上次資料');
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
  assert.equal(h.requests.length, 3); assert.equal(h.state().error, ''); assert.equal(h.state().status, '事件流已連線');
  assert.equal(h.state().data.commands[0].message, 'latest');
});

test('ready does not erase snapshot errors; successful refresh clears error and reflects current stream state', async () => {
  const h = harness(); await h.load(); const es = h.streams[0];
  es.emit('edge_event'); h.requests.at(-1).respond({error: 'read failed'}, 500); await tick();
  es.emit('error'); es.emit('ready'); assert.equal(h.state().error, 'read failed');
  es.emit('stream_error'); h.requests.at(-1).respond(fixture()); await tick();
  assert.equal(h.state().error, ''); assert.match(h.state().status, /重新連線/);
  es.emit('ready'); h.requests.at(-1).respond(fixture()); await tick(); assert.equal(h.state().status, '事件流已連線');
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
