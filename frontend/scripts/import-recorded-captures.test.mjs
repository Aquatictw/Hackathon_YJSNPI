import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { convertCaptures, readCaptureFiles, validateRecordedAck, ingestRecordedCatalog, sha256 } from './import-recorded-captures.mjs';
import { normalizeExporterBatch } from '../lib/rtdi/exporter-wire.ts';
import { joinPredictionActuals, projectExporterEvents } from '../lib/rtdi/backend-projection.ts';
import { decodeUtf8Base64Chunks } from '../lib/rtdi/raw-payload.ts';

const files = await readCaptureFiles();
const catalog = await convertCaptures(files);
const engineering = files.find(file => file.path.includes('vm_engineering'));
const engRows = engineering.bytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
const testFile = rows => [{ path: 'fixture.jsonl', bytes: Buffer.from(rows.map(row => JSON.stringify(row)).join('\n')) }];
const smallCatalog = await convertCaptures([engineering]);
const ack = batch => ({ batch_id: batch.batch_id, status: 'stored', accepted: batch.events.map(event => event.event_id), duplicates: [], rejected: [] });

test('real captures produce two actual runs with original scope, counts, times and no cloned startup run', () => {
  assert.deepEqual(catalog.manifest.counts, { input_rows: 1583, unique_capture_records: 818, duplicate_capture_rows: 765,
    excluded_records: 4, runs: 2, source_events: 814, batches: 9, backend_events: 1822 });
  assert.deepEqual(catalog.manifest.runs.map(run => [run.run_id, run.tester_id, run.label, run.counts.joined_predictions]), [
    ['ae20cd5ae29d47af87163265205ffced', 'group-6', 'Engineering check', 24],
    ['d132133657be459e8e97b6fd442142e2', 'group-6', 'Production run 3', 480],
  ]);
  assert.equal(catalog.manifest.runs[0].first_timestamp, '2026-09-19T06:32:37.975787+00:00');
  assert.equal(catalog.manifest.runs[1].last_timestamp, '2026-09-19T07:07:51.743604+00:00');
  assert.deepEqual(catalog.manifest.runs.map(run => run.sequence_gaps), [[], []]);
  assert.equal(catalog.manifest.excluded_records.filter(row => row.kind === 'monitor_start').length, 3);
  assert.equal(catalog.manifest.excluded_records.filter(row => row.kind === 'tp_info').length, 1);
});

test('every source identity, exact clock, original kind, mode and original JSON survives conversion', async () => {
  const source = new Map(files.flatMap(file => file.bytes.toString('utf8').trim().split(/\r?\n/).map(line => {
    const row = JSON.parse(line); return [row.event_id, row];
  })));
  const allProjections = [];
  for (const batch of catalog.batches) {
    assert.equal(batch.edge_id, 'grp6-recorded-capture');
    assert.ok(batch.events.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) < 4_194_304);
    const normalized = normalizeExporterBatch(batch);
    allProjections.push(...await projectExporterEvents(normalized.rawEvents, normalized.batch.events));
    for (const event of batch.events) {
      const row = source.get(event.event_id);
      assert.deepEqual(event.capture_record, row);
      assert.equal(event.run_id, row.run_id); assert.equal(event.tester_id, row.tester);
      assert.equal(event.timestamp, row.time); assert.equal(event.sequence, row.sequence);
      assert.equal(event.mode, 'replay'); assert.equal(event.source_mode, 'replay');
      assert.equal(event.original_source_mode, 'live'); assert.equal(event.original_kind, row.kind);
      assert.equal(event.recorded_import.mode, 'recorded'); assert.equal(event.recorded_import.live_integration, false);
      assert.equal(event.recorded_import.original_timestamp, row.timestamp);
      for (const field of ['request_id', 'prediction_id', 'prediction_ids', 'device_id', 'device_ids', 'model_sha256', 'response'])
        assert.deepEqual(event[field], row[field]);
      const proof = catalog.manifest.event_provenance.find(item => item.event_id === event.event_id);
      assert.equal(proof.capture_record_sha256, event.recorded_import.capture_record_sha256);
      for (const location of proof.locations) {
        const file = files.find(item => item.path === location.path);
        assert.deepEqual(JSON.parse(file.bytes.toString('utf8').split(/\r?\n/)[location.line - 1]), row);
      }
    }
  }
  assert.equal(joinPredictionActuals(allProjections).filter(row => row.type === 'prediction' && row.actual !== undefined).length, 504);
  assert.equal(allProjections.some(row => row.response_status === 'tester_confirmed'), false);
  assert.equal(allProjections.some(row => row.unit !== null), false);
});

test('capture order, duplicate file copies and production overlap do not change generated ingestion bytes', async () => {
  assert.deepEqual(await convertCaptures([...files].reverse()), catalog);
  const withoutOverlap = await convertCaptures(files.filter(file => !file.path.includes('capture_all')));
  assert.deepEqual(withoutOverlap.batches, catalog.batches);
  const copy = { path: 'copied-engineering.jsonl', bytes: engineering.bytes };
  assert.deepEqual((await convertCaptures([engineering, copy])).batches, smallCatalog.batches);
  const reverseRows = await convertCaptures(testFile([...engRows].reverse()));
  assert.deepEqual(reverseRows.batches, smallCatalog.batches);
});

test('batch splitting changes only batch membership/IDs, never source identities or payloads', async () => {
  const split = await convertCaptures([engineering], { batchSize: 7 });
  assert.equal(split.batches.length, 8);
  assert.deepEqual(split.batches.flatMap(batch => batch.events), smallCatalog.batches.flatMap(batch => batch.events));
  assert.equal(split.manifest.runs[0].counts.joined_predictions, 24);
  assert.ok(split.batches.every(batch => batch.events.length <= 7));
});

test('bad records, changing same-ID content, inconsistent clocks and duplicate sequences fail closed', async () => {
  const cases = [
    [rows => { rows[1].timestamp = 'invalid'; }, /Invalid captured/],
    [rows => { rows[1].time += 1; }, /Inconsistent captured clocks/],
    [rows => { rows[1].source_mode = 'replay'; }, /Invalid captured/],
    [rows => { rows.push({ ...rows[1], lot: 'changed' }); }, /Conflicting captured identity/],
    [rows => { rows[2].sequence = rows[1].sequence; }, /Conflicting captured sequence/],
    [rows => { delete rows.find(row => row.kind === 'prediction_actual').prediction_id; }, /original prediction_id/],
    [rows => { delete rows.find(row => row.kind === 'prediction_request').prediction_ids['1']; }, /original per-site identity/],
  ];
  for (const [mutate, expected] of cases) {
    const rows = structuredClone(engRows); mutate(rows);
    await assert.rejects(convertCaptures(testFile(rows)), expected);
  }
  await assert.rejects(convertCaptures([{ path: 'bad.jsonl', bytes: Buffer.from('{broken') }]), /Invalid captured/);
  const overflow = Buffer.from(engineering.bytes.toString('utf8').replace('1.2170000076293945', '1e400'));
  await assert.rejects(convertCaptures([{ path: 'overflow.jsonl', bytes: overflow }]), /Nonfinite/);
  await assert.rejects(convertCaptures(testFile([engRows[0]])), /No tester-scoped/);
  await assert.rejects(convertCaptures([engineering], { batchSize: 101 }), /batchSize/);
});

test('missing actual stays raw-only; unavailable prediction stays null; sequence gaps stay visible', async () => {
  const rows = structuredClone(engRows);
  rows.find(row => row.kind === 'prediction_actual').actual = null;
  const converted = await convertCaptures(testFile(rows));
  assert.equal(converted.manifest.runs[0].counts.projected_actuals, 23);
  assert.equal(converted.manifest.runs[0].counts.joined_predictions, 23);
  const missingPrediction = rows.find(row => row.kind === 'prediction_request');
  delete missingPrediction.predictions['1']; delete missingPrediction.prediction_ids['1'];
  const unavailable = await convertCaptures(testFile(rows.filter(row => row.kind !== 'measurement')));
  assert.deepEqual(unavailable.manifest.runs[0].sequence_gaps, [[5, 16]]);
  const normalized = normalizeExporterBatch(unavailable.batches[0]);
  const projected = await projectExporterEvents(normalized.rawEvents, normalized.batch.events);
  assert.equal(projected.find(row => row.type === 'prediction' && row.site_id === 1 && row.stage === 1).prediction, null);
});

test('ACK validation requires exact batch, complete disjoint IDs and no rejection', () => {
  const batch = smallCatalog.batches[0];
  validateRecordedAck(batch, ack(batch));
  validateRecordedAck(batch, { ...ack(batch), status: 'duplicate', accepted: [], duplicates: ack(batch).accepted });
  for (const change of [{ batch_id: 'wrong' }, { accepted: [] }, { duplicates: [batch.events[0].event_id] },
    { accepted: [...ack(batch).accepted.slice(1), 'unknown'] }, { rejected: [{ event_id: batch.events[0].event_id }] }])
    assert.throws(() => validateRecordedAck(batch, { ...ack(batch), ...change }), /acknowledgement|Acknowledgement/);
});

test('explicit transport rejects unsafe endpoint, live scope, mode changes and partial ACK without retries', async () => {
  const endpoint = 'http://127.0.0.1:5173/api/v1/events/batch';
  const never = async () => { throw Error('Unexpected fetch'); };
  await assert.rejects(ingestRecordedCatalog(smallCatalog, { endpoint: 'http://example.test/api/v1/events/batch', token: 'test', fetchImpl: never }), /Endpoint/);
  await assert.rejects(ingestRecordedCatalog(smallCatalog, { endpoint, fetchImpl: never }), /INGEST_TOKEN/);
  const changed = structuredClone(smallCatalog); changed.batches[0].events[0].mode = 'live';
  await assert.rejects(ingestRecordedCatalog(changed, { endpoint, token: 'test', fetchImpl: never }), /Only recorded/);
  let calls = 0;
  await assert.rejects(ingestRecordedCatalog(smallCatalog, { endpoint, token: 'test', fetchImpl: async () => {
    calls++; return Response.json({ run: { ...smallCatalog.manifest.runs[0], mode: 'live' } });
  } }), /Existing run scope/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(ingestRecordedCatalog(smallCatalog, { endpoint, token: 'test', fetchImpl: async (_url, options) => {
    calls++; assert.equal(options.redirect, 'error');
    return options.method === 'POST' ? Response.json({ ...ack(smallCatalog.batches[0]), accepted: [] }) : new Response(null, { status: 404 });
  } }), /Acknowledgement/);
  assert.equal(calls, 2);
});

// Exercise the real backend repository SQL in isolated in-memory SQLite. No server/network.
const env = {};
globalThis.__recordedCatalogTestEnv = env;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = globalThis.__recordedCatalogTestEnv;', shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[a-z]+$/.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/'))
      return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
const repo = await import('../lib/rtdi/repository.ts');
class LocalD1 {
  sql = new DatabaseSync(':memory:');
  constructor() {
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
      this.sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
    }
  }
  prepare(query) {
    const sql = this.sql;
    return { query, args: [], bind(...args) { this.args = args; return this; },
      async first() { return sql.prepare(query).get(...this.args) ?? null; },
      async all() { return { results: sql.prepare(query).all(...this.args) }; },
      async run() { return sql.prepare(query).run(...this.args); } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const results = statements.map(statement => ({ results: this.sql.prepare(statement.query).all(...statement.args) }));
      this.sql.exec('COMMIT'); return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

test('real captures ingest/retry through repository: two replay runs, 1822 events, 504 joins, original raw recovery, commands denied', async () => {
  env.DB = new LocalD1();
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (options.method !== 'POST') {
      const runId = decodeURIComponent(url.pathname.split('/').at(-1));
      const result = await repo.getRunSnapshot(runId, url.searchParams.get('tester_id'));
      return result ? Response.json(result) : new Response(null, { status: 404 });
    }
    const input = JSON.parse(options.body);
    const normalized = normalizeExporterBatch(input);
    return Response.json(await repo.ingestEdgeBatch(normalized.batch, normalized));
  };
  const options = { endpoint: 'http://127.0.0.1:5173/api/v1/events/batch', token: 'test-only', fetchImpl };
  try {
    assert.deepEqual(await ingestRecordedCatalog(catalog, options), { accepted: 814, duplicates: 0 });
    assert.deepEqual(await ingestRecordedCatalog(catalog, options), { accepted: 0, duplicates: 814 });
    assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM runs').get().n, 2);
    assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM events').get().n, 1822);
    assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM raw_events').get().n, 814);
    const discovered = await repo.listRuns();
    assert.equal(discovered.runs.length, 2);
    for (const run of catalog.manifest.runs) {
      const snapshot = await repo.getRunSnapshot(run.run_id, run.tester_id);
      assert.equal(snapshot.run.mode, 'replay'); assert.equal(snapshot.run.edge_id, 'grp6-recorded-capture');
      assert.equal(snapshot.events.length, run.counts.backend_events);
      assert.equal(snapshot.events.filter(row => row.type === 'prediction' && row.actual !== undefined).length, run.counts.joined_predictions);
      assert.equal(snapshot.evidence.length, run.counts.evidence);
      assert.equal(snapshot.events.some(row => row.source_mode !== 'replay'), false);
      assert.equal(snapshot.commands.length, 0);
      await assert.rejects(repo.createRunCommand(run.run_id, run.tester_id, { user_confirmed: true,
        request_id: 'test-no-machine-command', incident_id: 'test-incident', kind: 'show_message', message: 'must not execute' }), /live/);
    }
    for (const batch of catalog.batches) for (const event of batch.events) {
      const key = JSON.stringify([event.run_id, event.tester_id, event.event_id]);
      const chunks = env.DB.sql.prepare('SELECT payload_base64 FROM raw_event_chunks WHERE event_key = ? ORDER BY chunk_index').all(key);
      const raw = JSON.parse(decodeUtf8Base64Chunks(chunks.map(chunk => chunk.payload_base64)));
      assert.deepEqual(raw.capture_record, event.capture_record);
      assert.equal(raw.recorded_import.original_timestamp, event.capture_record.timestamp);
    }
  } finally { env.DB.sql.close(); }
});

test('offline CLI writes deterministic new outputs, rejects overwrites/ID overrides, and leaves evidence bytes unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'grp6-recorded-test-'));
  const output = join(directory, 'batches.json');
  const manifest = join(directory, 'catalog.json');
  const script = fileURLToPath(new URL('./import-recorded-captures.mjs', import.meta.url));
  const args = [script, '--input', engineering.path, '--output', output, '--manifest', manifest];
  try {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"network_requested": false/);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), smallCatalog.batches);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
    const conflict = spawnSync(process.execPath, [...args, '--batch-size', '7'], { encoding: 'utf8' });
    assert.equal(conflict.status, 1); assert.match(conflict.stderr, /Refusing to overwrite/);
    assert.equal(spawnSync(process.execPath, [script, '--run-id', 'cloned'], { encoding: 'utf8' }).status, 1);
    for (const file of await readCaptureFiles()) assert.equal(sha256(file.bytes), catalog.manifest.sources.find(source => source.path === file.path).sha256);
  } finally { await rm(directory, { recursive: true }); }
});
