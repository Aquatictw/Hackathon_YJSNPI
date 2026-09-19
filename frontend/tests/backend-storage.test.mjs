import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Run repository SQL against real SQLite; only the Cloudflare binding is replaced.
const env = {};
globalThis.__backendTestEnv = env;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = globalThis.__backendTestEnv;', shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[a-z]+$/.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')) {
      return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});
const repo = await import('../lib/rtdi/repository.ts');
const { normalizeExporterBatch } = await import('../lib/rtdi/exporter-wire.ts');
const { joinPredictionActuals } = await import('../lib/rtdi/backend-projection.ts');
const { edgeBatchSchema, edgeRecordSchema, canonicalJson } = await import('../lib/rtdi/wire.ts');
const { decodeUtf8Base64Chunks } = await import('../lib/rtdi/raw-payload.ts');
const { parseSnapshot } = await import('../lib/rtdi/dashboard.ts');
const { encodeSseEvent } = await import('../lib/rtdi/sse.ts');
const { commandResultSchema, createCommandSchema } = await import('../lib/rtdi/command-contract.ts');
const ingestRoute = await import('../app/api/v1/events/batch/route.ts');
const measurementRoute = await import('../app/api/v1/runs/[id]/measurements/route.ts');

class LocalD1 {
  sql = new DatabaseSync(':memory:');
  failCommit = false;
  constructor() { this.sql.exec(readFileSync(new URL('../drizzle/0000_grp6_backend.sql', import.meta.url), 'utf8')); }
  prepare(query) {
    const database = this.sql;
    const statement = { query, args: [], bind(...args) { this.args = args; return this; },
      async first() { return database.prepare(query).get(...this.args) ?? null; },
      async all() { return { results: database.prepare(query).all(...this.args) }; },
      async run() { return database.prepare(query).run(...this.args); },
    };
    return statement;
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const results = statements.map(statement => ({ results: this.sql.prepare(statement.query).all(...statement.args) }));
      if (this.failCommit && statements.some(statement => /^INSERT/.test(statement.query.trim()))) throw Error('injected commit failure');
      this.sql.exec('COMMIT'); return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const base = { schema_version: '1', mode: 'live', sequence: 1, timestamp: 1789796000, run_id: 'run', tester_id: 'tester', lot_id: 'lot', wafer_id: '14' };
const prediction = (overrides = {}) => ({ ...base, event_id: 'request-event', event_type: 'prediction_request', request_id: 'request', stage: 2,
  status: 'response_queued', device_ids: { '1': 'device-a', '2': 'device-b' }, prediction_ids: { '1': 'request:site:1', '2': 'request:site:2' },
  predictions: { '1': 1.2, '2': 2.4 }, coverage: { '1': 1, '2': 0.8 }, latency_ms: 1.7, model_sha256: 'model-sha', ...overrides });
const actual = (overrides = {}) => ({ ...base, sequence: 2, event_id: 'actual-event', event_type: 'prediction_actual', request_id: 'request',
  prediction_id: 'request:site:1', device_id: 'device-a', site: '1', stage: 2, actual: 1.3, predicted: 1.2,
  unit: null, prediction_status: 'response_queued', ...overrides });
const bundle = (events, batch_id = crypto.randomUUID()) => ({ schema_version: '1', edge_id: 'edge', batch_id, events });
const ingest = async (events, batchId) => { const value = normalizeExporterBatch(bundle(events, batchId)); return repo.ingestEdgeBatch(value.batch, value); };
const reset = () => { env.DB?.sql.close(); env.DB = new LocalD1(); env.INGEST_TOKEN = 'test-ingest-token'; };
const request = value => new Request('https://example.test/api/v1/events/batch', { method: 'POST', headers: { Authorization: 'Bearer test-ingest-token', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

test('multi-site projections commit with source IDs, raw recovery, retry and conflicting identity guards', async () => {
  reset();
  assert.deepEqual((await ingest([prediction()], 'first')).accepted, ['request-event']);
  const snapshot = parseSnapshot(await repo.getRunSnapshot('run', 'tester'), 'run', 'tester');
  const predictions = snapshot.events.filter(event => event.type === 'prediction');
  assert.equal(predictions.length, 2);
  assert.deepEqual(predictions.map(event => event.site_id).sort(), [1, 2]);
  assert.deepEqual(predictions.map(event => event.coverage).sort(), [0.8, 1]);
  for (const event of predictions) {
    assert.equal(event.original_request_id, 'request'); assert.equal(event.source_event_id, 'request-event');
    assert.equal(event.response_status, 'response_queued'); assert.equal(event.tester_receipt_id, undefined);
    assert.equal(event.unit, null); assert.equal(event.attempt, undefined); assert.equal(event.data_quality, 'partial');
  }
  assert.deepEqual((await ingest([prediction()], 'first')).duplicates, ['request-event']);
  assert.deepEqual((await ingest([prediction()], 'new-batch')).duplicates, ['request-event']);
  assert.equal((await repo.getRunSnapshot('run', 'tester')).events.length, 3);
  await assert.rejects(ingest([prediction({ predictions: { '1': 9, '2': 2.4 } })]), repo.IdentityConflictError);
  await assert.rejects(ingest([prediction({ device_ids: { '1': 'wrong', '2': 'device-b' } })], 'first'), repo.IdentityConflictError);
  const chunks = env.DB.sql.prepare('SELECT payload_base64 FROM raw_event_chunks ORDER BY chunk_index').all();
  assert.equal(decodeUtf8Base64Chunks(chunks.map(chunk => chunk.payload_base64)), canonicalJson(prediction()));
  // Repeated stage requests have separate request and per-site identities.
  await ingest([prediction({ event_id: 'repeat', request_id: 'request-2', prediction_ids: { '1': 'request-2:site:1', '2': 'request-2:site:2' } })]);
  assert.equal((await repo.getRunSnapshot('run', 'tester')).events.filter(event => event.type === 'prediction').length, 4);
});

test('out-of-order actuals join uniquely; cross-run/tester/device/stage and ambiguous actuals do not join', async () => {
  reset();
  await ingest([actual()]);
  assert.equal((await repo.getRunSnapshot('run', 'tester')).events.filter(event => event.type === 'prediction').length, 0);
  await ingest([prediction()]);
  let snapshot = await repo.getRunSnapshot('run', 'tester');
  assert.equal(snapshot.events.find(event => event.type === 'prediction' && event.site_id === 1).actual, 1.3);
  assert.equal(snapshot.events.find(event => event.type === 'prediction' && event.site_id === 2).actual, undefined);
  await ingest([prediction({ tester_id: 'other' }), actual({ run_id: 'other-run' })]);
  await assert.rejects(repo.getRunSnapshot('run'), repo.AmbiguousScopeError);
  assert.equal((await repo.getRunSnapshot('run', 'other')).events.some(event => event.actual !== undefined), false);
  const p = snapshot.events.find(event => event.type === 'prediction' && event.site_id === 1);
  const a = snapshot.events.find(event => event.type === 'prediction_actual');
  delete p.actual; delete p.absolute_error;
  for (const change of [{ run_id: 'wrong' }, { tester_id: 'wrong' }, { device_id: 'wrong' }, { stage: 3 }, { wafer_id: '15' }, { site_id: 2 }, { attempt: 2 }]) {
    assert.equal(joinPredictionActuals([p, { ...a, ...change }])[0].actual, undefined);
  }
  assert.equal(joinPredictionActuals([p, { ...p, event_id: 'ambiguous-prediction' }, a])[0].actual, undefined);
  await ingest([actual({ event_id: 'ambiguous-actual', actual: 1.4 })]);
  snapshot = await repo.getRunSnapshot('run', 'tester');
  assert.equal(snapshot.events.find(event => event.type === 'prediction' && event.site_id === 1).actual, undefined);
});

test('SSE row cursors resume projected events and remain scoped', async () => {
  reset(); await ingest([prediction(), actual()]);
  const first = await repo.getRunEventUpdates('run', 'tester', 0, 2);
  const second = await repo.getRunEventUpdates('run', 'tester', first.cursor, 100);
  assert.equal(first.updates.length + second.updates.length, 5);
  const events = [...first.updates, ...second.updates].map(update => update.event);
  assert.equal(new Set(events.map(event => event.event_id)).size, 5);
  assert.equal(events.filter(event => event.type === 'prediction').length, 2);
  assert.equal(events.filter(event => event.type === 'prediction_actual').length, 1);
  for (const update of second.updates) {
    const frame = new TextDecoder().decode(encodeSseEvent({ id: update.cursor, event: 'edge_event', data: update.event }));
    assert.equal(JSON.parse(frame.split('\ndata: ')[1].trim()).run_id, 'run');
  }
  assert.equal((await repo.getRunEventUpdates('run', 'tester', second.cursor)).updates.length, 0);
  assert.equal(await repo.getRunEventUpdates('run', 'wrong', 0), null);
});

test('HTTP ACK is withheld when atomic storage fails; retry stores projections once', async () => {
  reset(); env.DB.failCommit = true;
  const incoming = bundle([prediction()], 'atomic');
  assert.equal((await ingestRoute.POST(request(incoming))).status, 503);
  for (const table of ['events', 'raw_events', 'raw_event_chunks', 'batches', 'runs']) assert.equal(env.DB.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  env.DB.failCommit = false;
  const response = await ingestRoute.POST(request(incoming));
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).accepted, ['request-event']);
  assert.deepEqual((await (await ingestRoute.POST(request(incoming))).json()).duplicates, ['request-event']);
});

test('missing actuals and unavailable site predictions stay unavailable; malformed site identity rejects batch', async () => {
  reset(); await ingest([prediction({ predictions: { '1': 1.2 }, prediction_ids: { '1': 'request:site:1' }, status: 'insufficient_current_data' }), actual({ actual: null })]);
  const snapshot = await repo.getRunSnapshot('run', 'tester');
  assert.equal(snapshot.events.some(event => event.type === 'prediction_actual'), false);
  const unavailable = snapshot.events.find(event => event.type === 'prediction' && event.site_id === 2);
  assert.equal(unavailable.prediction, null); assert.equal(unavailable.response_status, 'insufficient_data');
  const response = await ingestRoute.POST(request(bundle([prediction({ device_ids: { '1': 'device-a' } })])));
  assert.equal(response.status, 422);
});

test('measurement reads are scoped, paged and preserve unknown metadata, units and flags', async () => {
  reset();
  const measurements = Array.from({ length: 105 }, (_, index) => ({ test_number: index, canonical_feature: `test-${index}`, value: index, unit: null, scaling: null, flags: '0x0' }));
  await ingest([{ ...base, event_id: 'device-event', event_type: 'device_completed', device_id: 'device-a', site: '1', attempt: null,
    attempt_status: 'unverified_sdk_field', measurements, received_count: 105 }]);
  const page = await repo.getDeviceMeasurements('run', 'tester', 'device-event', 0, 100);
  assert.equal(page.measurements.length, 100); assert.equal(page.next_offset, 100); assert.equal(page.metadata.attempt, null);
  assert.equal(page.metadata.data_quality, undefined); assert.deepEqual(page.measurements[0], measurements[0]);
  assert.equal((await repo.getDeviceMeasurements('run', 'tester', 'device-event', 100, 100)).measurements.length, 5);
  assert.equal(await repo.getDeviceMeasurements('run', 'other', 'device-event'), null);
  const call = query => measurementRoute.GET(new Request(`https://example.test/api/v1/runs/run/measurements?${query}`), { params: Promise.resolve({ id: 'run' }) });
  assert.equal((await call('tester_id=tester&event_id=device-event&limit=101')).status, 422);
  assert.equal((await call('event_id=device-event')).status, 422);
  assert.equal((await call('tester_id=tester&event_id=device-event')).status, 200);
});

test('persisted commands enforce scope, expiry, idempotency, receipt presence and terminal transitions', async () => {
  reset();
  await repo.ingestEdgeBatch(edgeBatchSchema.parse({ schema_version: 1, edge_id: 'edge', batch_id: 'incident', events: [{ event_id: 'evidence', type: 'evidence', source_mode: 'live',
    run_id: 'run', tester_id: 'tester', timestamp: new Date().toISOString(), incident_id: 'incident', evidence_id: 'evidence' }] }));
  const command = createCommandSchema.parse({ request_id: 'cmd', incident_id: 'incident', kind: 'show_message', message: 'inspect', user_confirmed: true });
  await repo.createRunCommand('run', 'tester', command);
  assert.equal((await repo.createRunCommand('run', 'tester', command)).status, 'duplicate');
  const ack = (overrides = {}) => commandResultSchema.parse({ ack_id: crypto.randomUUID(), run_id: 'run', tester_id: 'tester', status: 'received', occurred_at: new Date().toISOString(), ...overrides });
  await assert.rejects(repo.recordCommandResult('cmd', ack({ tester_id: 'wrong' })), /範圍不符/);
  assert.throws(() => ack({ status: 'tester_confirmed' }));
  const received = ack(); await repo.recordCommandResult('cmd', received);
  assert.equal((await repo.recordCommandResult('cmd', received)).duplicate, true);
  await repo.recordCommandResult('cmd', ack({ status: 'queued_to_tester' }));
  assert.equal((await repo.getRunSnapshot('run', 'tester')).commands[0].status, 'queued_to_tester');
  await repo.recordCommandResult('cmd', ack({ status: 'tester_confirmed', tester_receipt_id: 'synthetic-test-receipt' }));
  await assert.rejects(repo.recordCommandResult('cmd', ack()), /狀態不可/);
  await repo.createRunCommand('run', 'tester', { ...command, request_id: 'expired' });
  env.DB.sql.prepare("UPDATE commands SET expires_at = '2000-01-01T00:00:00.000Z' WHERE command_id = 'expired'").run();
  await assert.rejects(repo.recordCommandResult('expired', ack()), /超過/);
  assert.deepEqual(await repo.getPendingCommands('tester', 'run'), []);
  assert.equal(env.DB.sql.prepare("SELECT status FROM commands WHERE command_id = 'expired'").get().status, 'expired');
});


test('wire schema properties stay aligned and exporter numeric/string versions remain compatible', async () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/edge-v1.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(schema.$defs.event.properties).sort(), Object.keys(edgeRecordSchema.innerType().shape).sort());
  for (const version of [1, '1']) {
    reset();
    const source = prediction({ schema_version: version, wafer_id: 14 });
    const response = await ingestRoute.POST(request({ ...bundle([source]), schema_version: version }));
    assert.equal(response.status, 200);
    const snapshot = await repo.getRunSnapshot('run', 'tester');
    assert.equal(snapshot.events.every(event => event.wafer_id === '14'), true);
    assert.equal(snapshot.events.every(event => event.timestamp === new Date(base.timestamp * 1000).toISOString()), true);
    assert.equal(edgeBatchSchema.safeParse({ schema_version: 1, edge_id: 'edge', batch_id: 'normalized', events: snapshot.events }).success, true);
  }
});

test('ingest accepts bounded gzip through projection and exposes no ACK on identity conflicts', async () => {
  reset();
  const incoming = bundle([prediction()]);
  const bytes = new Uint8Array(await new Response(new Response(JSON.stringify(incoming)).body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const response = await ingestRoute.POST(new Request('https://example.test/api/v1/events/batch', {
    method: 'POST', headers: { Authorization: 'Bearer test-ingest-token', 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: bytes,
  }));
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).accepted, ['request-event']);
  const conflict = await ingestRoute.POST(request(bundle([prediction({ stage: 3 })])));
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).accepted, undefined);
});

test('large measurement pages stop at byte limit and reject corrupted raw chunks', async () => {
  reset();
  const measurements = Array.from({ length: 100 }, () => ({ value: 1, annotation: '測量'.repeat(1000) }));
  await ingest([{ ...base, event_id: 'large-device', event_type: 'device_completed', measurements }]);
  const page = await repo.getDeviceMeasurements('run', 'tester', 'large-device', 0, 100);
  assert.ok(page.measurements.length < 100 && page.measurements.length > 0);
  assert.equal(page.next_offset, page.measurements.length);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 262_144);
  env.DB.sql.prepare('DELETE FROM raw_event_chunks WHERE chunk_index = 1').run();
  await assert.rejects(repo.getDeviceMeasurements('run', 'tester', 'large-device'), /Incomplete raw payload/);
});
