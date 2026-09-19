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
  beforeExecute = null;
  constructor() { this.sql.exec(readFileSync(new URL('../drizzle/0000_grp6_backend.sql', import.meta.url), 'utf8')); }
  prepare(query) {
    const database = this.sql;
    const owner = this;
    const statement = { query, args: [], bind(...args) { this.args = args; return this; },
      async first() { await owner.beforeExecute?.([this]); return database.prepare(query).get(...this.args) ?? null; },
      async all() { await owner.beforeExecute?.([this]); return { results: database.prepare(query).all(...this.args) }; },
      async run() { await owner.beforeExecute?.([this]); return database.prepare(query).run(...this.args); },
    };
    return statement;
  }
  async batch(statements) {
    await this.beforeExecute?.(statements);
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

test('snapshot and UI never join replay or simulation actuals to live predictions', async () => {
  const { predictionRows } = await import('../lib/rtdi/ui-predictions.ts');
  for (const mode of ['replay', 'simulation']) {
    for (const actualFirst of [false, true]) {
      reset();
      const other = actual({ event_id: 'other-mode', mode });
      for (const event of actualFirst ? [other, prediction()] : [prediction(), other]) await ingest([event]);
      let snapshot = await repo.getRunSnapshot('run', 'tester');
      assert.equal(snapshot.events.find(event => event.type === 'prediction').actual, undefined);
      assert.equal(predictionRows(snapshot.events)[0].actual, undefined);
      await ingest([actual()]);
      snapshot = await repo.getRunSnapshot('run', 'tester');
      assert.equal(snapshot.events.find(event => event.type === 'prediction').actual, 1.3);
      assert.equal(predictionRows(snapshot.events)[0].actual, 1.3);
      await ingest([actual({ event_id: 'second-live-actual' })]);
      snapshot = await repo.getRunSnapshot('run', 'tester');
      assert.equal(snapshot.events.find(event => event.type === 'prediction').actual, undefined);
      assert.equal(predictionRows(snapshot.events)[0].actual, undefined);
    }
  }
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
  assert.equal((await repo.getRunSnapshot('run', 'tester')).commands[0].tester_receipt_id, null);
  assert.equal((await repo.createRunCommand('run', 'tester', command)).status, 'duplicate');
  const ack = (overrides = {}) => commandResultSchema.parse({ ack_id: crypto.randomUUID(), run_id: 'run', tester_id: 'tester', status: 'received', occurred_at: new Date().toISOString(), ...overrides });
  await assert.rejects(repo.recordCommandResult('cmd', ack({ tester_id: 'wrong' })), /範圍不符/);
  assert.throws(() => ack({ status: 'tester_confirmed' }));
  const received = ack(); await repo.recordCommandResult('cmd', received);
  assert.equal((await repo.recordCommandResult('cmd', received)).duplicate, true);
  await repo.recordCommandResult('cmd', ack({ status: 'queued_to_tester' }));
  assert.equal((await repo.getRunSnapshot('run', 'tester')).commands[0].status, 'queued_to_tester');
  await repo.recordCommandResult('cmd', ack({ status: 'tester_confirmed', tester_receipt_id: 'synthetic-test-receipt' }));
  let confirmed = parseSnapshot(await repo.getRunSnapshot('run', 'tester'), 'run', 'tester').commands[0];
  assert.equal(confirmed.tester_receipt_id, 'synthetic-test-receipt');
  await repo.recordCommandResult('cmd', ack({ status: 'tester_confirmed', tester_receipt_id: 'newer-persisted-receipt', occurred_at: '2020-01-01T00:00:00.000Z' }));
  confirmed = parseSnapshot(await repo.getRunSnapshot('run', 'tester'), 'run', 'tester').commands[0];
  assert.equal(confirmed.tester_receipt_id, 'newer-persisted-receipt');
  // Corrupt/unrelated rows must not supply a receipt to this scoped command.
  const insert = env.DB.sql.prepare(`INSERT INTO command_results (ack_id, command_id, run_id, tester_id, status, tester_receipt_id, detail, occurred_at, payload_hash) VALUES (?, 'cmd', ?, ?, ?, ?, '', ?, ?)`);
  for (const [id, run, tester, status] of [['wrong-run', 'other', 'tester', 'tester_confirmed'], ['wrong-tester', 'run', 'other', 'tester_confirmed'], ['wrong-status', 'run', 'tester', 'received']]) {
    insert.run(id, run, tester, status, 'unrelated', new Date().toISOString(), id);
  }
  assert.equal((await repo.getRunSnapshot('run', 'tester')).commands[0].tester_receipt_id, 'newer-persisted-receipt');
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


// R2 race barriers pause before the real SQL write/transaction, never inside it.
// A competing request then commits through the same repository path before release.
function pauseCommandWrite(table) {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  env.DB.beforeExecute = async statements => {
    if (!statements.some(statement => statement.query.includes(`INSERT INTO ${table}`))) return;
    env.DB.beforeExecute = null;
    entered.resolve();
    await release.promise;
  };
  return { entered: entered.promise, release: () => release.resolve() };
}
const commandInput = (overrides = {}) => createCommandSchema.parse({ request_id: 'r2-command', incident_id: 'r2-incident', kind: 'show_message', message: 'Inspect site 1', user_confirmed: true, ...overrides });
const commandAck = (overrides = {}) => commandResultSchema.parse({ ack_id: crypto.randomUUID(), run_id: 'r2-run', tester_id: 'r2-tester', status: 'received', occurred_at: '2000-01-01T00:00:00.000Z', ...overrides });
const commandRow = (id = 'r2-command') => env.DB.sql.prepare('SELECT * FROM commands WHERE command_id = ?').get(id);
const ackRows = () => env.DB.sql.prepare('SELECT * FROM command_results ORDER BY rowid').all();
async function seedCommandScopes() {
  reset();
  await repo.ingestEdgeBatch(edgeBatchSchema.parse({ schema_version: 1, edge_id: 'r2-edge', batch_id: 'r2-seed', events:
    [['r2-run', 'r2-tester', 'live'], ['other-run', 'r2-tester', 'live'], ['r2-run', 'other-tester', 'live'], ['replay-run', 'r2-tester', 'replay']]
      .map(([run_id, tester_id, source_mode]) => ({ event_id: 'r2-evidence', type: 'evidence', source_mode, run_id, tester_id,
        timestamp: new Date().toISOString(), incident_id: 'r2-incident', evidence_id: 'r2-evidence' })) }));
}
const createR2 = (input = commandInput(), run = 'r2-run', tester = 'r2-tester') => repo.createRunCommand(run, tester, input);
const isCode = code => error => error instanceof repo.InvalidCommandError && error.code === code;

test('R2 concurrent command creation returns an identical duplicate or a typed conflict', { timeout: 5000 }, async () => {
  for (const conflict of [false, true]) {
    await seedCommandScopes();
    const barrier = pauseCommandWrite('commands');
    const delayed = createR2().then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    const winner = await createR2(commandInput(conflict ? { message: 'Different content' } : {}));
    barrier.release();
    const outcome = await delayed;
    assert.equal(winner.status, 'queued');
    if (conflict) assert.ok(outcome.error instanceof repo.IdentityConflictError, String(outcome.error));
    else { assert.equal(outcome.value?.status, 'duplicate'); assert.deepEqual(outcome.value.command, winner.command); }
    assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM commands').get().n, 1);
    assert.equal(commandRow().message, winner.command.message);
  }
});

test('R2 concurrent command identity cannot cross run/tester scope', { timeout: 5000 }, async () => {
  for (const [run, tester] of [['other-run', 'r2-tester'], ['r2-run', 'other-tester']]) {
    await seedCommandScopes();
    const barrier = pauseCommandWrite('commands');
    const delayed = createR2().then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    await createR2(commandInput(), run, tester);
    barrier.release();
    assert.ok((await delayed).error instanceof repo.IdentityConflictError);
    assert.equal(commandRow().run_id, run); assert.equal(commandRow().tester_id, tester);
  }
});

test('R2 command scope validation and duplicate creation preserve terminal records', async () => {
  await seedCommandScopes();
  await assert.rejects(createR2(commandInput(), 'r2-run', null), repo.AmbiguousScopeError);
  await assert.rejects(createR2(commandInput(), 'missing'), isCode('run_not_found'));
  await assert.rejects(createR2(commandInput(), 'replay-run'), isCode('non_live_run'));
  await assert.rejects(createR2(commandInput({ incident_id: 'missing' })), isCode('incident_not_found'));
  await createR2();
  await repo.recordCommandResult('r2-command', commandAck({ status: 'failed' }));
  const original = { ...commandRow() };
  const duplicate = await createR2();
  assert.equal(duplicate.status, 'duplicate'); assert.equal(duplicate.command.status, 'failed');
  assert.deepEqual({ ...commandRow() }, original);
});

test('R2 server time rejects backdated/future/equal-deadline acceptance of expired queued commands', async () => {
  await seedCommandScopes();
  for (const occurred_at of ['2000-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z']) {
    for (const status of ['received', 'queued_to_tester', 'tester_confirmed', 'rejected', 'failed']) {
      const id = crypto.randomUUID();
      await createR2(commandInput({ request_id: id }));
      env.DB.sql.prepare("UPDATE commands SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE command_id = ?").run(id);
      await assert.rejects(repo.recordCommandResult(id, commandAck({ occurred_at, status, ...(status === 'tester_confirmed' ? { tester_receipt_id: 'synthetic' } : {}) })), isCode('command_expired'));
      assert.equal(commandRow(id).status, 'queued');
    }
  }
  assert.equal(ackRows().length, 0);
});

test('R2 expiry is rechecked inside the ACK transaction after a request was delayed', { timeout: 5000 }, async () => {
  await seedCommandScopes(); await createR2();
  const barrier = pauseCommandWrite('command_results');
  const delayed = repo.recordCommandResult('r2-command', commandAck()).then(value => ({ value }), error => ({ error }));
  await barrier.entered;
  env.DB.sql.prepare("UPDATE commands SET expires_at = '2001-01-01T00:00:00.000Z'").run();
  barrier.release();
  assert.ok(isCode('command_expired')((await delayed).error));
  assert.equal(commandRow().status, 'queued'); assert.equal(ackRows().length, 0);
});

test('R2 already-received commands may finish after expiry and exact old ACK retries remain harmless', async () => {
  await seedCommandScopes(); await createR2();
  const received = commandAck();
  await repo.recordCommandResult('r2-command', received);
  env.DB.sql.prepare("UPDATE commands SET expires_at = '2001-01-01T00:00:00.000Z'").run();
  const confirmed = commandAck({ status: 'tester_confirmed', tester_receipt_id: 'synthetic-r2-receipt', occurred_at: '2099-01-01T00:00:00.000Z' });
  await repo.recordCommandResult('r2-command', confirmed);
  assert.equal((await repo.recordCommandResult('r2-command', received)).duplicate, true);
  assert.equal((await repo.recordCommandResult('r2-command', confirmed)).duplicate, true);
  assert.equal(commandRow().status, 'tester_confirmed'); assert.equal(ackRows().length, 2);
  const snapshot = await repo.getRunSnapshot('r2-run', 'r2-tester');
  assert.equal(snapshot.commands[0].tester_receipt_id, 'synthetic-r2-receipt');
});

test('R2 stale ACKs cannot overwrite any terminal state or a newer queued-to-tester state', { timeout: 5000 }, async () => {
  for (const status of ['tester_confirmed', 'failed', 'rejected', 'expired', 'queued_to_tester']) {
    await seedCommandScopes(); await createR2();
    const stale = commandAck();
    const barrier = pauseCommandWrite('command_results');
    const delayed = repo.recordCommandResult('r2-command', stale).then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    const winner = commandAck({ status, ...(status === 'tester_confirmed' ? { tester_receipt_id: 'synthetic-winner' } : {}) });
    await repo.recordCommandResult('r2-command', winner);
    barrier.release();
    assert.ok(isCode('invalid_transition')((await delayed).error), status);
    assert.equal(commandRow().status, status); assert.deepEqual(ackRows().map(row => row.ack_id), [winner.ack_id]);
  }
});

test('R2 concurrent identical/conflicting ACK IDs return duplicate/conflict without a stale status update', { timeout: 5000 }, async () => {
  for (const conflict of [false, true]) {
    await seedCommandScopes(); await createR2();
    const loser = commandAck();
    const barrier = pauseCommandWrite('command_results');
    const delayed = repo.recordCommandResult('r2-command', loser).then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    const winner = conflict ? { ...loser, status: 'tester_confirmed', tester_receipt_id: 'synthetic-winner' } : loser;
    await repo.recordCommandResult('r2-command', winner);
    barrier.release();
    const outcome = await delayed;
    if (conflict) assert.ok(outcome.error instanceof repo.IdentityConflictError, String(outcome.error));
    else assert.equal(outcome.value?.duplicate, true);
    assert.equal(commandRow().status, winner.status); assert.equal(ackRows().length, 1);
  }
});

test('R2 ACK IDs cannot be reused on another command, run or tester', async () => {
  await seedCommandScopes(); await createR2(); await createR2(commandInput({ request_id: 'second-command' }));
  for (const scope of [{ run_id: 'other-run' }, { tester_id: 'other-tester' }]) {
    await assert.rejects(repo.recordCommandResult('r2-command', commandAck(scope)), isCode('scope_mismatch'));
  }
  await assert.rejects(repo.recordCommandResult('missing', commandAck()), isCode('command_not_found'));
  const ack = commandAck(); await repo.recordCommandResult('r2-command', ack);
  await assert.rejects(repo.recordCommandResult('second-command', ack), repo.IdentityConflictError);
  for (const scope of [{ run_id: 'other-run' }, { tester_id: 'other-tester' }]) {
    await assert.rejects(repo.recordCommandResult('r2-command', { ...ack, ...scope }), repo.IdentityConflictError);
  }
  assert.equal(ackRows().length, 1); assert.equal(commandRow('second-command').status, 'queued');
});

test('R2 failed status write rolls back its ACK; a committed retry retains only supplied receipt provenance', async () => {
  await seedCommandScopes(); await createR2();
  const ack = commandAck({ status: 'tester_confirmed', tester_receipt_id: 'synthetic-transaction-receipt' });
  env.DB.sql.exec("CREATE TRIGGER fail_command_update BEFORE UPDATE ON commands BEGIN SELECT RAISE(ABORT, 'injected status write failure'); END");
  await assert.rejects(repo.recordCommandResult('r2-command', ack), /injected status write failure/);
  assert.equal(ackRows().length, 0); assert.equal(commandRow().status, 'queued');
  env.DB.sql.exec('DROP TRIGGER fail_command_update');
  await repo.recordCommandResult('r2-command', ack);
  assert.equal(ackRows()[0].tester_receipt_id, ack.tester_receipt_id);
  assert.equal(commandRow().status, 'tester_confirmed');
});

test('R2 pending-command expiry changes only the requested run/tester and preserves received commands', async () => {
  await seedCommandScopes();
  await createR2(); await createR2(commandInput({ request_id: 'other-run-command' }), 'other-run');
  await createR2(commandInput({ request_id: 'other-tester-command' }), 'r2-run', 'other-tester');
  await createR2(commandInput({ request_id: 'received-command' }));
  await repo.recordCommandResult('received-command', commandAck());
  env.DB.sql.prepare("UPDATE commands SET expires_at = '2001-01-01T00:00:00.000Z'").run();
  assert.deepEqual(await repo.getPendingCommands('r2-tester', 'r2-run'), []);
  assert.equal(commandRow().status, 'expired'); assert.equal(commandRow('received-command').status, 'received');
  assert.equal(commandRow('other-run-command').status, 'queued'); assert.equal(commandRow('other-tester-command').status, 'queued');
  assert.deepEqual(await repo.getPendingCommands('r2-tester'), []);
  assert.equal(commandRow('other-run-command').status, 'expired'); assert.equal(commandRow('other-tester-command').status, 'queued');
});
