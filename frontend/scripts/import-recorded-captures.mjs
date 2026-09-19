#!/usr/bin/env node
// Offline by default. Captured machine evidence is always imported as replay.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { normalizeExporterBatch } from '../lib/rtdi/exporter-wire.ts';
import { joinPredictionActuals, projectExporterEvents } from '../lib/rtdi/backend-projection.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_INPUTS = [
  'results/vm_engineering/grp6_core_eng_evidence.jsonl',
  'results/vm_production/grp6_core_prod3_evidence.jsonl',
  'results/vm_production/grp6_core_prod3_capture_all.jsonl',
];
const EDGE_ID = 'grp6-recorded-capture';
const RUN_LABELS = {
  ae20cd5ae29d47af87163265205ffced: 'Engineering check',
  d132133657be459e8e97b6fd442142e2: 'Production run 3',
};
const MAX_BYTES = 3_900_000; // Below the HTTP route's 4 MiB uncompressed-body limit.
const id = z.string().min(1).max(120);
const captureSchema = z.object({
  schema_version: z.literal(1), event_id: id, run_id: id,
  sequence: z.number().int().nonnegative(), kind: id,
  source_mode: z.literal('live'),
  timestamp: z.string().datetime({ offset: true }),
  time: z.number().finite().nonnegative().max(8_640_000_000),
  tester: id.optional(),
}).passthrough();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const scope = row => JSON.stringify([row.run_id, row.tester ?? null]);
const identity = row => JSON.stringify([row.run_id, row.tester ?? null, row.event_id]);
const tally = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
const unique = values => [...new Set(values)].sort(compare);
const finiteJson = value => typeof value === 'number' ? Number.isFinite(value)
  : value && typeof value === 'object' ? Object.values(value).every(finiteJson) : true;

export async function readCaptureFiles(inputs = DEFAULT_INPUTS) {
  return Promise.all(unique(inputs.map(input => resolve(ROOT, input))).map(async path => {
    const name = relative(ROOT, path).replaceAll('\\', '/');
    if (name.startsWith('../') || isAbsolute(name)) throw Error('Capture inputs must be inside the repository.');
    return { path: name, bytes: await readFile(path) };
  }));
}

function recordedEvent(row) {
  // Source paths and line numbers belong in the catalog, not identity payloads:
  // overlapping captures and relocated exact copies must ingest idempotently.
  return {
    ...row, schema_version: '1', mode: 'replay', source_mode: 'replay',
    event_type: row.kind, original_kind: row.kind, timestamp: row.time, tester_id: row.tester,
    lot_id: row.lot === '' ? null : row.lot ?? null, wafer_id: row.wafer === '' ? null : row.wafer ?? null,
    original_source_mode: row.source_mode,
    data_quality: 'partial',
    recorded_import: {
      version: 1, mode: 'recorded', live_integration: false,
      original_source_mode: row.source_mode, original_timestamp: row.timestamp,
      capture_record_sha256: sha256(canonical(row)),
    },
    capture_record: row,
  };
}

function packet(events) {
  return { schema_version: 1, edge_id: EDGE_ID,
    batch_id: `recorded-${sha256(canonical([EDGE_ID, events]))}`, events };
}
const packetBytes = events => Buffer.byteLength(JSON.stringify({
  schema_version: 1, edge_id: EDGE_ID, batch_id: `recorded-${'0'.repeat(64)}`, events,
}));

/** Convert genuine raw captures. IDs, request maps, values and clocks are never reassigned. */
export async function convertCaptures(files, { batchSize = 100 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw Error('batchSize must be 1–100.');
  if (!files.length) throw Error('No capture files supplied.');
  const records = new Map();
  const sources = [];
  for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
    let count = 0;
    const bytes = Buffer.from(file.bytes);
    for (const [index, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let row;
      try { row = captureSchema.parse(JSON.parse(line)); }
      catch { throw Error(`Invalid captured JSON record at ${file.path}:${index + 1}`); }
      if (!finiteJson(row)) throw Error(`Nonfinite captured value at ${file.path}:${index + 1}`);
      if (Math.abs(Date.parse(row.timestamp) - row.time * 1000) > 1)
        throw Error(`Inconsistent captured clocks at ${file.path}:${index + 1}`);
      const key = identity(row);
      const entry = records.get(key);
      if (entry && canonical(entry.row) !== canonical(row))
        throw Error(`Conflicting captured identity ${key}`);
      const location = { path: file.path, line: index + 1 };
      if (entry) entry.locations.push(location);
      else records.set(key, { row, locations: [location] });
      count++;
    }
    if (!count) throw Error(`Empty capture: ${file.path}`);
    sources.push({ path: file.path, sha256: sha256(bytes), bytes: bytes.length, rows: count });
  }
  const entries = [...records.values()];
  const runScopes = new Set(entries.filter(({ row }) => row.kind === 'lot_start' && row.tester).map(({ row }) => scope(row)));
  const selected = entries.filter(({ row }) => runScopes.has(scope(row)))
    .sort((a, b) => compare(scope(a.row), scope(b.row)) || a.row.sequence - b.row.sequence || compare(a.row.event_id, b.row.event_id));
  if (!selected.length) throw Error('No tester-scoped captured test runs (lot_start required).');
  const sequences = new Set();
  for (const { row } of selected) {
    const key = JSON.stringify([scope(row), row.sequence]);
    if (sequences.has(key)) throw Error(`Conflicting captured sequence ${key}`);
    sequences.add(key);
    if (row.kind === 'prediction_actual' && !row.prediction_id)
      throw Error(`Captured actual lacks its original prediction_id: ${row.event_id}`);
  }
  const batches = [];
  const runs = [];
  for (const runScope of [...runScopes].sort(compare)) {
    const runEntries = selected.filter(({ row }) => scope(row) === runScope);
    const rows = runEntries.map(entry => entry.row);
    const events = rows.map(recordedEvent);
    const runBatches = [];
    let pending = [];
    for (const event of events) {
      const next = [...pending, event];
      if (pending.length && (next.length > batchSize || packetBytes(next) > MAX_BYTES)) {
        runBatches.push(packet(pending)); pending = [];
      }
      pending.push(event);
      if (packetBytes(pending) > MAX_BYTES)
        throw Error(`Captured event exceeds import byte limit: ${event.event_id}`);
    }
    if (pending.length) runBatches.push(packet(pending));
    const normalized = [];
    const projections = [];
    for (const batch of runBatches) {
      const parsed = normalizeExporterBatch(batch);
      normalized.push(...parsed.batch.events);
      projections.push(...await projectExporterEvents(parsed.rawEvents, parsed.batch.events));
    }
    const joined = joinPredictionActuals(projections);
    const predictions = joined.filter(event => event.type === 'prediction');
    const sequenceGaps = [];
    for (let index = 1; index < rows.length; index++)
      if (rows[index].sequence !== rows[index - 1].sequence + 1)
        sequenceGaps.push([rows[index - 1].sequence + 1, rows[index].sequence - 1]);
    runs.push({
      run_id: rows[0].run_id, tester_id: rows[0].tester,
      label: RUN_LABELS[rows[0].run_id] ?? `Recorded run ${rows[0].run_id}`, mode: 'recorded', backend_mode: 'replay',
      original_source_modes: unique(rows.map(row => row.source_mode)),
      first_timestamp: rows[0].timestamp, last_timestamp: rows.at(-1).timestamp,
      sequence_first: rows[0].sequence, sequence_last: rows.at(-1).sequence, sequence_gaps: sequenceGaps,
      model_sha256: unique(rows.map(row => row.model_sha256).filter(Boolean)),
      sources: unique(runEntries.flatMap(entry => entry.locations.map(location => location.path))),
      counts: { source_events: rows.length, source_kinds: tally(rows.map(row => row.kind)),
        batches: runBatches.length, projected_predictions: predictions.length,
        projected_actuals: projections.filter(event => event.type === 'prediction_actual').length,
        joined_predictions: predictions.filter(event => event.actual !== undefined).length,
        evidence: normalized.filter(event => event.type === 'evidence').length,
        backend_events: normalized.length + projections.length },
      batch_ids: runBatches.map(batch => batch.batch_id),
    });
    batches.push(...runBatches);
  }
  const excluded = entries.filter(({ row }) => !runScopes.has(scope(row))).map(({ row, locations }) => ({
    event_id: row.event_id, run_id: row.run_id, tester_id: row.tester ?? null, kind: row.kind,
    reason: row.tester ? 'startup_scope_without_lot_start' : 'missing_tester_identity', locations,
  })).sort((a, b) => compare(a.event_id, b.event_id));
  const manifest = {
    schema_version: 1, catalog: 'grp6-recorded-captures-v1', mode: 'recorded', backend_mode: 'replay',
    live_integration: false, edge_id: EDGE_ID, sources,
    counts: { input_rows: sources.reduce((sum, source) => sum + source.rows, 0),
      unique_capture_records: entries.length, duplicate_capture_rows: entries.reduce((sum, entry) => sum + entry.locations.length - 1, 0),
      excluded_records: excluded.length, runs: runs.length, source_events: selected.length, batches: batches.length,
      backend_events: runs.reduce((sum, run) => sum + run.counts.backend_events, 0) },
    runs, excluded_records: excluded,
    event_provenance: selected.map(({ row, locations }) => ({
      event_id: row.event_id, run_id: row.run_id, tester_id: row.tester, sequence: row.sequence,
      timestamp: row.timestamp, capture_record_sha256: sha256(canonical(row)), locations,
    })),
    batches_sha256: sha256(JSON.stringify(batches)),
    limitations: [
      'Historical recorded captures; backend replay mode disables commands. This is not live transport acceptance.',
      'Runs preserve original identities. Repeated supplied ORE inputs are not independent measurement data.',
      'Only captured first-12 measurement samples, targets and alert windows exist; no full DeviceCompletedBundle is fabricated.',
      'Exporter normalization exposes millisecond ISO times; exact original ISO timestamps and Unix seconds remain in capture_record and recorded_import.',
      'Startup-only records without a tester-scoped lot_start are excluded with provenance; overlapping files do not create extra runs.',
      'Queued or callback-returned actions remain unconfirmed. No tester receipt is inferred or synthesized.',
      'Do not import into an existing live run scope. Identity conflicts require owner review, never ID rewriting.',
    ],
  };
  return { batches, manifest };
}

export function validateRecordedAck(batch, ack) {
  const expected = new Set(batch.events.map(event => event.event_id));
  if (!ack || ack.batch_id !== batch.batch_id || !['stored', 'duplicate'].includes(ack.status) ||
    !Array.isArray(ack.accepted) || !Array.isArray(ack.duplicates) || !Array.isArray(ack.rejected) || ack.rejected.length)
    throw Error(`Incomplete acknowledgement for ${batch.batch_id}`);
  const seen = [...ack.accepted, ...ack.duplicates];
  if (expected.size !== batch.events.length || seen.length !== expected.size ||
    new Set(seen).size !== expected.size || seen.some(eventId => !expected.has(eventId)))
    throw Error(`Acknowledgement identity mismatch for ${batch.batch_id}`);
}

/** Explicit opt-in transport for A. Tests inject fetch; conversion never uses it. */
export async function ingestRecordedCatalog(catalog, { endpoint, token, fetchImpl = globalThis.fetch }) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/v1/events/batch' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
    throw Error('Endpoint must be HTTPS or loopback HTTP /api/v1/events/batch without credentials/query/fragment.');
  if (!token) throw Error('Set INGEST_TOKEN before explicit ingestion.');
  for (const batch of catalog.batches) {
    if (batch.edge_id !== EDGE_ID || batch.events.some(event => event.mode !== 'replay' || event.source_mode !== 'replay' || event.recorded_import?.mode !== 'recorded'))
      throw Error('Only recorded replay batches can be imported.');
  }
  // Preserve original scope, but never silently reuse a live scope (repository mode is sticky).
  for (const run of catalog.manifest.runs) {
    const snapshot = new URL(`/api/v1/runs/${encodeURIComponent(run.run_id)}`, url);
    snapshot.searchParams.set('tester_id', run.tester_id);
    const response = await fetchImpl(snapshot, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) continue;
    if (!response.ok) throw Error(`Recorded scope preflight failed (${response.status}).`);
    const body = await response.json();
    if (body.run?.run_id !== run.run_id || body.run?.tester_id !== run.tester_id || body.run?.mode !== 'replay')
      throw Error('Existing run scope is not the same recorded/replay identity.');
  }
  let accepted = 0;
  let duplicates = 0;
  for (const batch of catalog.batches) {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(batch), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`Recorded ingestion failed (${response.status}); stop and review, never rewrite IDs.`);
    const ack = await response.json();
    validateRecordedAck(batch, ack);
    accepted += ack.accepted.length; duplicates += ack.duplicates.length;
  }
  return { accepted, duplicates };
}

async function writeNewOrIdentical(path, text) {
  try { await writeFile(path, text, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== text) throw Error(`Refusing to overwrite different existing content: ${path}`);
  }
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string', multiple: true },
    output: { type: 'string' }, manifest: { type: 'string' }, endpoint: { type: 'string' },
    'batch-size': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node frontend/scripts/import-recorded-captures.mjs [--input <repo-relative JSONL> ...] [--output <new batches.json>] [--manifest <new catalog.json>] [--batch-size 1..100] [--endpoint <URL>]');
    console.log('Default: validate the stored engineering/production captures offline. Explicit --endpoint requires INGEST_TOKEN. Run/tester IDs, dates and recorded mode cannot be overridden.');
    return;
  }
  const catalog = await convertCaptures(await readCaptureFiles(values.input),
    { batchSize: values['batch-size'] === undefined ? 100 : Number(values['batch-size']) });
  if (values.output) await writeNewOrIdentical(resolve(values.output), `${JSON.stringify(catalog.batches)}\n`);
  if (values.manifest) await writeNewOrIdentical(resolve(values.manifest), `${JSON.stringify(catalog.manifest, null, 2)}\n`);
  console.log(JSON.stringify({ mode: 'recorded', backend_mode: 'replay', network_requested: Boolean(values.endpoint),
    edge_id: EDGE_ID, counts: catalog.manifest.counts,
    runs: catalog.manifest.runs.map(({ run_id, tester_id, label, counts }) => ({ run_id, tester_id, label, counts })) }, null, 2));
  if (values.endpoint) console.log(JSON.stringify(await ingestRecordedCatalog(catalog, { endpoint: values.endpoint, token: process.env.INGEST_TOKEN })));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
