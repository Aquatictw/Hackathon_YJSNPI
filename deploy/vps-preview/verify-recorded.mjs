// Read-only verification of published recorded captures. Makes no model requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [origin, catalogPath] = process.argv.slice(2);
if (!origin || !catalogPath) throw Error('Usage: verify-recorded.mjs <origin> <catalog.json>');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
async function get(path) {
  const response = await fetch(new URL(path, origin), {signal: AbortSignal.timeout(30_000)});
  assert.equal(response.status, 200, path);
  return response;
}
const discovery = await (await get('/api/v1/runs?limit=100')).json();
const results = [];
for (const expected of catalog.runs) {
  const listed = discovery.runs.find(run => run.run_id === expected.run_id && run.tester_id === expected.tester_id);
  assert.ok(listed, 'Recorded scope discoverable');
  assert.equal(listed.edge_id, catalog.edge_id);
  assert.equal(listed.mode, 'replay');
  const path = `/api/v1/runs/${encodeURIComponent(expected.run_id)}`;
  const query = `?tester_id=${encodeURIComponent(expected.tester_id)}`;
  const snapshot = await (await get(path + query)).json();
  assert.equal(snapshot.run.edge_id, catalog.edge_id);
  assert.equal(snapshot.run.mode, 'replay');
  assert.equal(snapshot.events.length, expected.counts.backend_events);
  assert.equal(snapshot.evidence.length, expected.counts.evidence);
  assert.equal(snapshot.commands.length, 0);
  assert.ok(Math.abs(Date.parse(snapshot.run.last_event_at) - Date.parse(expected.last_timestamp)) <= 1, 'Original source time');
  const predictions = snapshot.events.filter(event => event.type === 'prediction');
  assert.equal(predictions.length, expected.counts.projected_predictions);
  assert.equal(predictions.filter(event => Number.isFinite(event.actual)).length, expected.counts.joined_predictions);
  assert.ok(snapshot.events.every(event => event.run_id === expected.run_id && event.tester_id === expected.tester_id && event.source_mode === 'replay'));
  assert.ok(predictions.every(event => !event.tester_receipt_id), 'No fabricated tester receipts');
  const stream = await get(path + '/events' + query);
  assert.match(stream.headers.get('content-type'), /text[/]event-stream/);
  const reader = stream.body.getReader();
  let text = '';
  try {
    while (!text.includes('event: ready')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
      assert.ok(text.length < 100_000, 'Bounded stream verification');
    }
    assert.match(text, /event: ready/);
  } finally { await reader.cancel(); }
  results.push({run_id: expected.run_id, tester_id: expected.tester_id, events: snapshot.events.length,
    predictions: predictions.length, joined_actuals: predictions.filter(event => Number.isFinite(event.actual)).length,
    incidents: snapshot.incidents.length, last_event_at: snapshot.run.last_event_at, sse: 'ready', mode: 'recorded/replay'});
}
console.log(JSON.stringify({origin, runs: results, paid_ai_calls: 0}, null, 2));
