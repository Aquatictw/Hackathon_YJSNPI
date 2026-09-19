import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeExporterBatch } from '../lib/rtdi/exporter-wire.ts';
import { canonicalJson, contentHash } from '../lib/rtdi/wire.ts';
import { chunkUtf8Base64 } from '../lib/rtdi/raw-payload.ts';
import { backfillRunSummaries, parseArgs } from '../../deploy/vps-preview/backfill-run-summaries.mjs';

const summary = (overrides = {}) => ({
  schema_version: '1', event_id: 'summary', event_type: 'run_summary', sequence: 21,
  mode: 'live', timestamp: 1789841459.496, run_id: 'run', tester_id: 'group-6',
  lot_id: 'lot', wafer_id: 3, completed_devices: 80, good_devices: 74, yield_fraction: 0.925, ...overrides,
});
const envelope = (events, edge_id = 'grp6-hc-relay') => ({ schema_version: '1', batch_id: 'batch', edge_id, events });
const normalize = event => normalizeExporterBatch(envelope([event])).batch.events[0];

test('summary normalization preserves measured zero, scope, original clock and live/recorded mode', () => {
  for (const mode of ['live', 'replay', 'simulation']) {
    const raw = summary({ mode, completed_devices: 0, good_devices: 0, yield_fraction: 0 });
    const original = structuredClone(raw);
    const result = normalizeExporterBatch(envelope([raw], mode === 'replay' ? 'grp6-recorded-capture' : 'grp6-hc-relay'));
    const event = result.batch.events[0];
    assert.equal(event.yield, 0);
    assert.equal(event.completed_devices, 0);
    assert.equal(event.source_mode, mode);
    assert.equal(event.timestamp, '2026-09-19T18:10:59.496Z');
    assert.equal(event.wafer_id, '3');
    assert.equal(event.lot_id, 'lot');
    assert.equal(event.event_id, raw.event_id);
    assert.deepEqual(result.rawEvents[0].payload, original);
    assert.deepEqual(result.identityPayload.events[0], original);
    assert.deepEqual(raw, original);
  }
});

test('missing yield/counts remain missing and unrelated exporter events cannot invent measured yield', () => {
  const absent = summary();
  delete absent.yield_fraction;
  assert.equal(normalize(absent).yield, undefined);
  assert.equal(normalize(absent).completed_devices, 80);
  delete absent.completed_devices;
  delete absent.good_devices;
  assert.equal(normalize(absent).completed_devices, undefined);
  assert.equal(normalize({ ...absent, yield_fraction: 0.7 }).yield, 0.7);
  assert.equal(normalize(summary({ event_type: 'prediction_request' })).yield, undefined);
  assert.equal(normalize(summary({ completed_devices: 3, good_devices: 1, yield_fraction: 1 / 3 })).yield, 1 / 3);
});

test('summary validation rejects bad supplied values and inconsistent counts/fractions', () => {
  for (const patch of [
    { yield_fraction: -0.01 }, { yield_fraction: 1.01 }, { yield_fraction: NaN },
    { yield_fraction: Infinity }, { yield_fraction: '0.925' }, { yield_fraction: null },
    { completed_devices: -1 }, { completed_devices: 1.5 }, { completed_devices: '80' },
    { completed_devices: null }, { completed_devices: Number.MAX_SAFE_INTEGER + 1 },
    { good_devices: -1 }, { good_devices: 81 }, { good_devices: 2.5 }, { good_devices: null },
    { good_devices: '74' }, { yield_fraction: 0.5 },
    { completed_devices: 0, good_devices: 0, yield_fraction: 1 },
  ]) assert.throws(() => normalize(summary(patch)), undefined, JSON.stringify(patch));
});

async function fixture(t, inputs = [summary(), summary({ event_id: 'recorded', run_id: 'old-run', mode: 'replay' })]) {
  const directory = mkdtempSync(join(tmpdir(), 'grp6-yield-repair-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'fixture.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(new URL('../drizzle/0000_grp6_backend.sql', import.meta.url), 'utf8'));
  for (const raw of inputs) {
    const edge = raw.mode === 'replay' ? 'grp6-recorded-capture' : 'grp6-hc-relay';
    const key = JSON.stringify([raw.run_id, raw.tester_id, raw.event_id]);
    // Reproduce the old normalizer's projection even for malformed raw inputs.
    const oldRaw = { ...raw };
    delete oldRaw.completed_devices; delete oldRaw.good_devices; delete oldRaw.yield_fraction;
    const old = normalize(oldRaw);
    const hash = await contentHash(raw);
    const chunked = chunkUtf8Base64(canonicalJson(raw), 61);
    db.prepare('INSERT INTO raw_events (key,event_id,run_id,tester_id,edge_id,event_type,payload_hash,payload_bytes,chunk_count) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(key, raw.event_id, raw.run_id, raw.tester_id, edge, raw.event_type, hash, chunked.byteLength, chunked.chunks.length);
    chunked.chunks.forEach((chunk, index) => db.prepare('INSERT INTO raw_event_chunks (key,event_key,chunk_index,payload_base64) VALUES (?,?,?,?)')
      .run(JSON.stringify([key, String(index)]), key, index, chunk));
    db.prepare('INSERT INTO events (key,event_id,batch_key,edge_id,run_id,tester_id,lot_id,wafer_id,type,mode,occurred_at,sequence,payload_hash,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(key, raw.event_id, JSON.stringify([edge, 'batch']), edge, raw.run_id, raw.tester_id, old.lot_id ?? null, old.wafer_id ?? null,
        old.type, old.source_mode, old.timestamp, old.sequence, hash, canonicalJson(old));
  }
  db.close();
  return dbPath;
}

function withDatabase(dbPath, callback) {
  const db = new DatabaseSync(dbPath);
  try { return callback(db); } finally { db.close(); }
}
function dump(dbPath) {
  return withDatabase(dbPath, db => Object.fromEntries(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT rowid AS _rowid, * FROM ${name} ORDER BY rowid`).all()]),
  ));
}

test('CLI default dry-run is read-only; apply is additive, scoped, idempotent and preserves all IDs/raw/hashes', async t => {
  const dbPath = await fixture(t);
  const before = dump(dbPath);
  const bytes = readFileSync(dbPath);
  const script = fileURLToPath(new URL('../../deploy/vps-preview/backfill-run-summaries.mjs', import.meta.url));
  const cli = spawnSync(process.execPath, [script, '--db', dbPath], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.eligible, 2);
  assert.equal(report.updated, 0);
  assert.deepEqual(readFileSync(dbPath), bytes);
  assert.deepEqual(dump(dbPath), before);
  assert.equal((await backfillRunSummaries({ dbPath, apply: true })).updated, 2);
  const after = dump(dbPath);
  for (const row of after.events) {
    const previous = before.events.find(event => event.key === row.key);
    assert.deepEqual(JSON.parse(row.payload), { ...JSON.parse(previous.payload), completed_devices: 80, yield: 0.925 });
    row.payload = previous.payload;
  }
  assert.deepEqual(after, before);
  const stable = dump(dbPath);
  assert.equal((await backfillRunSummaries({ dbPath, apply: true })).updated, 0);
  assert.deepEqual(dump(dbPath), stable);
});

test('repair preserves zero and does not derive missing yield from valid counts', async t => {
  const noFraction = summary({ event_id: 'counts-only' }); delete noFraction.yield_fraction;
  const neither = summary({ event_id: 'no-fields' });
  delete neither.yield_fraction; delete neither.completed_devices; delete neither.good_devices;
  const dbPath = await fixture(t, [summary({ completed_devices: 0, good_devices: 0, yield_fraction: 0 }), noFraction, neither]);
  assert.equal((await backfillRunSummaries({ dbPath, apply: true })).updated, 2);
  const events = dump(dbPath).events.map(row => JSON.parse(row.payload));
  assert.equal(events.find(event => event.event_id === 'summary').yield, 0);
  assert.equal(events.find(event => event.event_id === 'counts-only').yield, undefined);
  assert.equal(events.find(event => event.event_id === 'no-fields').completed_devices, undefined);
});

test('one invalid raw summary prevents every repair before the first UPDATE', async t => {
  const dbPath = await fixture(t, [summary({ event_id: 'a-valid' }), summary({ event_id: 'z-invalid', good_devices: 81 })]);
  // A write would produce a different error: validation must finish before writes.
  withDatabase(dbPath, db => db.exec("CREATE TRIGGER reject_write BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'unexpected write'); END"));
  const before = dump(dbPath);
  await assert.rejects(backfillRunSummaries({ dbPath, apply: true }), /good_devices/);
  assert.deepEqual(dump(dbPath), before);
});

for (const [label, sql, message] of [
  ['raw hash', "UPDATE raw_events SET payload_hash = 'corrupt'", /hash mismatch/],
  ['event hash', "UPDATE events SET payload_hash = 'corrupt'", /hash mismatch/],
  ['raw byte size', 'UPDATE raw_events SET payload_bytes = payload_bytes + 1', /byte length/],
  ['chunk count', 'UPDATE raw_events SET chunk_count = chunk_count + 1', /chunk count/],
  ['chunk index', 'UPDATE raw_event_chunks SET chunk_index = chunk_index + 100', /order mismatch/],
  ['raw identity', "UPDATE raw_events SET tester_id = 'other'", /tester_id mismatch/],
  ['stored clock', "UPDATE events SET occurred_at = '2026-09-20T00:00:00.000Z'", /timestamp mismatch/],
  ['source mode', "UPDATE events SET mode = 'simulation'", /source_mode mismatch/],
  ['yield conflict', "UPDATE events SET payload = json_set(payload, '$.yield', 0.5)", /yield projection conflict/],
  ['count conflict', "UPDATE events SET payload = json_set(payload, '$.completed_devices', 79)", /completed_devices projection conflict/],
  ['missing event', 'DELETE FROM events', /missing normalized event/],
]) {
  test(`repair refuses ${label} corruption without mutation`, async t => {
    const dbPath = await fixture(t);
    withDatabase(dbPath, db => db.exec(sql));
    const before = dump(dbPath);
    await assert.rejects(backfillRunSummaries({ dbPath }), message);
    await assert.rejects(backfillRunSummaries({ dbPath, apply: true }), message);
    assert.deepEqual(dump(dbPath), before);
  });
}

test('SQLite failure on a later update rolls back earlier repairs', async t => {
  const dbPath = await fixture(t, [summary({ event_id: 'a' }), summary({ event_id: 'z' })]);
  withDatabase(dbPath, db => db.exec("CREATE TRIGGER reject_second BEFORE UPDATE ON events WHEN OLD.event_id = 'z' BEGIN SELECT RAISE(ABORT, 'injected update failure'); END"));
  const before = dump(dbPath);
  await assert.rejects(backfillRunSummaries({ dbPath, apply: true }), /injected update failure/);
  assert.deepEqual(dump(dbPath), before);
});

test('repair requires explicit apply and rejects unsafe/missing paths without file creation', async t => {
  assert.deepEqual(parseArgs(['--db', 'x']), { dbPath: 'x', apply: false });
  assert.deepEqual(parseArgs(['--db', 'x', '--dry-run']), { dbPath: 'x', apply: false });
  assert.deepEqual(parseArgs(['--apply', '--db', 'x']), { dbPath: 'x', apply: true });
  for (const args of [[], ['--db'], ['--db', 'x', '--remote'], ['--db', 'x', '--apply', '--dry-run'], ['--db', 'x', '--apply', '--apply']]) {
    assert.throws(() => parseArgs(args));
  }
  for (const dbPath of ['https://example.test/db', 'file:///tmp/db', '//server/share/db', '//server/share/db'.replaceAll('/', String.fromCharCode(92)), ':memory:']) {
    await assert.rejects(backfillRunSummaries({ dbPath, apply: true }), /local SQLite file/);
  }
  const directory = mkdtempSync(join(tmpdir(), 'grp6-missing-db-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const missing = join(directory, 'missing.sqlite');
  await assert.rejects(backfillRunSummaries({ dbPath: missing, apply: true }), /ENOENT/);
  assert.equal(existsSync(missing), false);
});
