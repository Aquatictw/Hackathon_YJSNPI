import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { edgeBatchSchema, canonicalJson, contentHash } from '../lib/rtdi/wire.ts';
import { runToolInvestigation } from '../lib/rtdi/agent.ts';
import { canApplyCommandStatus, commandResultSchema, createCommandSchema } from '../lib/rtdi/command-contract.ts';
import { encodeSseEvent, parseEventCursor } from '../lib/rtdi/sse.ts';
import { replayJsonlToEdgeBatches } from '../lib/rtdi/replay-adapter.ts';
import { normalizeExporterBatch } from '../lib/rtdi/exporter-wire.ts';
import { HttpInputError, readJsonBody } from '../lib/rtdi/http.ts';
import { chunkUtf8Base64 } from '../lib/rtdi/raw-payload.ts';

const fixturePath = new URL('../contracts/examples/edge-v1-anomaly-batch.json', import.meta.url);

test('Edge v1 requires explicit provenance and unique scoped event ids', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(edgeBatchSchema.safeParse(fixture).success, true);
  const missingMode = structuredClone(fixture);
  delete missingMode.events[0].source_mode;
  assert.equal(edgeBatchSchema.safeParse(missingMode).success, false);
  const duplicate = structuredClone(fixture);
  duplicate.events.push(structuredClone(duplicate.events[0]));
  assert.equal(edgeBatchSchema.safeParse(duplicate).success, false);
  const duplicateEvidence = structuredClone(fixture);
  duplicateEvidence.events[1].evidence_id = duplicateEvidence.events[0].evidence_id;
  assert.equal(edgeBatchSchema.safeParse(duplicateEvidence).success, false);
});

test('canonical hashes stay stable across object key order', async () => {
  const left = { b: 2, a: { z: 1, y: [3, 4] } };
  const right = { a: { y: [3, 4], z: 1 }, b: 2 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(await contentHash(left), await contentHash(right));
});

test('agent performs a bounded multi-step tool investigation with evidence trace', async () => {
  const responses = [
    { status: 'completed', output: [{ type: 'function_call', name: 'get_run_summary', arguments: '{"run_id":"RUN-1","tester_id":"T-1"}', call_id: 'call-1' }] },
    { status: 'completed', output: [{ type: 'function_call', name: 'get_incident_evidence', arguments: '{"run_id":"RUN-1","incident_id":"INC-1"}', call_id: 'call-2' }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '觀察：Site 1 有均值上升。[EV-1]\n可能原因：尚待確認。\n建議：比較其他 site。' }] }] },
  ];
  const requestBodies = [];
  const fetcher = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const calls = [];
  const executeTool = async (name, args) => {
    calls.push({ name, args });
    return name === 'get_run_summary'
      ? { output: { run_id: 'RUN-1', source_mode: 'replay' }, evidence_ids: [] }
      : { output: { incident_id: 'INC-1', observed: 1.42 }, evidence_ids: ['EV-1'] };
  };
  const result = await runToolInvestigation({ apiKey: 'test-key', model: 'test-model', question: '哪個 site 異常？', history: [], scope: { run_id: 'RUN-1', tester_id: 'T-1', incident_id: 'INC-1' }, executeTool, fetcher });
  assert.deepEqual(calls.map(call => call.name), ['get_run_summary', 'get_incident_evidence']);
  assert.deepEqual(result.evidence_ids, ['EV-1']);
  assert.equal(result.tool_trace.length, 2);
  assert.equal(requestBodies[0].tools.every(tool => tool.strict === true), true);
  assert.equal(requestBodies[0].tool_choice, 'required');
  assert.equal(requestBodies[1].tool_choice, 'auto');
  assert.equal(requestBodies[1].input.some(item => item.type === 'function_call_output' && item.call_id === 'call-1'), true);
});

test('agent rejects citations that were not returned by tools', async () => {
  const responses = [
    { status: 'completed', output: [{ type: 'function_call', name: 'get_incident_evidence', arguments: '{"run_id":"RUN-1","incident_id":"INC-1"}', call_id: 'call-1' }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '觀察：有異常。[EV-INVENTED]' }] }] },
  ];
  const fetcher = async () => new Response(JSON.stringify(responses.shift()), { status: 200 });
  await assert.rejects(() => runToolInvestigation({
    apiKey: 'test-key', model: 'test-model', question: '分析', history: [], scope: { run_id: 'RUN-1', incident_id: 'INC-1' },
    executeTool: async () => ({ output: { incident_id: 'INC-1' }, evidence_ids: ['EV-REAL'] }), fetcher,
  }), /outside the verified tool results/);
});

test('agent refuses an unbounded tool-call chain', async () => {
  const fetcher = async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'function_call', name: 'get_run_summary', arguments: '{"run_id":"RUN-1","tester_id":null}', call_id: crypto.randomUUID() }] }), { status: 200 });
  await assert.rejects(() => runToolInvestigation({ apiKey: 'test-key', model: 'test-model', question: 'loop', history: [], scope: { run_id: 'RUN-1' }, executeTool: async () => ({ output: {}, evidence_ids: [] }), fetcher, maxToolCalls: 2 }), /tool-call limit/);
});

test('commands require an explicit user confirmation and a stable request id', () => {
  const command = { request_id: 'CMD-1', incident_id: 'INC-1', kind: 'show_message', message: 'Check site 1 contact.', ttl_seconds: 60, user_confirmed: true };
  assert.equal(createCommandSchema.safeParse(command).success, true);
  assert.equal(createCommandSchema.safeParse({ ...command, user_confirmed: false }).success, false);
  assert.equal(createCommandSchema.safeParse({ ...command, request_id: '' }).success, false);
});

test('tester confirmation requires a receipt and command states cannot move backward', () => {
  const result = { ack_id: 'ACK-1', run_id: 'RUN-1', tester_id: 'T-1', status: 'tester_confirmed', tester_receipt_id: 'RECEIPT-1', detail: '', occurred_at: '2026-09-19T08:00:00.000Z' };
  assert.equal(commandResultSchema.safeParse(result).success, true);
  assert.equal(commandResultSchema.safeParse({ ...result, tester_receipt_id: null }).success, false);
  assert.equal(canApplyCommandStatus('queued', 'received'), true);
  assert.equal(canApplyCommandStatus('received', 'queued_to_tester'), true);
  assert.equal(canApplyCommandStatus('tester_confirmed', 'received'), false);
  assert.equal(canApplyCommandStatus('failed', 'tester_confirmed'), false);
});

test('SSE frames preserve a resumable numeric cursor', () => {
  const frame = new TextDecoder().decode(encodeSseEvent({ id: 42, event: 'edge_event', data: { event_id: 'EV-42' } }));
  assert.match(frame, /^id: 42\nevent: edge_event\ndata: \{"event_id":"EV-42"\}\n\n$/);
  assert.equal(parseEventCursor('42'), 42);
  assert.equal(parseEventCursor('-1'), 0);
  assert.equal(parseEventCursor('not-a-number'), 0);
});

test('the real grp6 replay JSONL converts to deterministic Edge v1 batches', async () => {
  const replay = await readFile(new URL('../../results/replay/replay.jsonl', import.meta.url), 'utf8');
  const options = { edgeId: 'grp6-replay', runId: 'RUN-REPLAY-1', testerId: 'grp6-replay', startedAt: '2026-09-19T08:00:00.000Z' };
  const first = await replayJsonlToEdgeBatches(replay.split(/\r?\n/), options);
  const second = await replayJsonlToEdgeBatches(replay.split(/\r?\n/), options);
  assert.equal(first.length, 1);
  assert.equal(first[0].events.length, 14);
  assert.deepEqual(first, second);
  assert.equal(first[0].events.every(event => event.source_mode === 'replay' && event.data_quality === 'partial'), true);
  assert.equal(first[0].events.every(event => event.type === 'evidence' && event.evidence_id && event.incident_id), true);
});

test('the merged grp6 exporter envelope normalizes alerts and preserves raw events', () => {
  const base = { schema_version: '1', sequence: 1, mode: 'live', timestamp: 1789796000, tester_id: 'group-6', run_id: 'RUN-LIVE-1', lot_id: 'LOT-1', wafer_id: '14' };
  const incoming = {
    schema_version: '1', edge_id: 'grp6-edge', batch_id: 'BATCH-1', events: [
      { ...base, event_id: 'EVENT-ALERT-1', event_type: 'alert', alert: {
        kind: 'mean_drift_up', message: 'Site 4 mean changed.', test: 'Main.demo#P1', site: '4',
        completed_devices: 32, observed: 1.3, reference: 0.98, score: 3.5,
        series: [0.9, 1.1, 1.3], site_series: { '4': [0.9, 1.1, 1.3] }, suggestion: 'Check thermal settling.',
      } },
      { ...base, event_id: 'EVENT-DEVICE-1', event_type: 'device_completed', sequence: 2, site: '1', device_id: 'PART-1', data_quality: 'complete', measurements: [{ test_number: 1, value: 1.2 }] },
    ],
  };
  const normalized = normalizeExporterBatch(incoming);
  assert.equal(normalized.batch.schema_version, 1);
  assert.equal(normalized.batch.events[0].type, 'evidence');
  assert.equal(normalized.batch.events[0].site_id, 4);
  assert.equal(normalized.batch.events[1].type, 'run_summary');
  assert.equal(normalized.batch.events[1].device_id, 'PART-1');
  assert.equal(normalized.rawEvents[1].payload.measurements.length, 1);
});

test('gzip JSON input is bounded by compressed and decompressed limits', async () => {
  const payload = JSON.stringify({ schema_version: '1', value: 'x'.repeat(2048) });
  const compressed = new Uint8Array(await new Response(
    new Response(payload).body.pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer());
  const request = new Request('https://example.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: compressed });
  assert.deepEqual(await readJsonBody(request, { maxCompressedBytes: 4096, maxDecompressedBytes: 4096, allowGzip: true }), JSON.parse(payload));
  const oversized = new Request('https://example.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: compressed });
  await assert.rejects(() => readJsonBody(oversized, { maxCompressedBytes: 4096, maxDecompressedBytes: 100, allowGzip: true }), error => error instanceof HttpInputError && error.status === 413);
});

test('large UTF-8 raw payloads are split into D1-safe base64 chunks', () => {
  const source = JSON.stringify({ text: '量測資料'.repeat(400) });
  const result = chunkUtf8Base64(source, 128);
  const decoded = Buffer.concat(result.chunks.map(chunk => Buffer.from(chunk, 'base64'))).toString('utf8');
  assert.equal(decoded, source);
  assert.equal(result.chunks.every(chunk => Buffer.from(chunk, 'base64').byteLength <= 128), true);
  assert.equal(result.byteLength, Buffer.byteLength(source));
});
