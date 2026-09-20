// Run on the VPS using its isolated Node runtime after activation/recovery.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Discovery must remain healthy even after the optional training scope is deleted.
export async function verifyStoredRuns(read) {
  const discovery = await (await read('/api/v1/runs?limit=100')).json();
  assert.ok(Array.isArray(discovery.runs), 'Run discovery list');
  assert.ok(discovery.next_offset === null || (Number.isSafeInteger(discovery.next_offset) && discovery.next_offset > 0), 'Run discovery pagination');
  for (const run of discovery.runs) {
    assert.ok(typeof run.run_id === 'string' && run.run_id.length > 0 && typeof run.tester_id === 'string' && run.tester_id.length > 0, 'Discovered scope identity');
    assert.ok(['live', 'replay'].includes(run.mode), 'Discovered source mode');
  }
  const seedPath = '/api/v1/runs/grp6-replay-demo?tester_id=grp6-replay';
  // Probe directly: the seed can be present beyond the first discovery page.
  const seedResponse = await read(seedPath, [200, 404]);
  const seedPresent = seedResponse.status === 200;
  let snapshot;
  let selected;
  if (seedPresent) {
    selected = {run_id: 'grp6-replay-demo', tester_id: 'grp6-replay', mode: 'replay'};
    snapshot = await seedResponse.json();
  } else {
    await seedResponse.json();
    assert.ok(!discovery.runs.some(run => run.run_id === 'grp6-replay-demo' && run.tester_id === 'grp6-replay'), 'Discovery must not advertise missing seed');
    selected = discovery.runs[0];
    if (!selected) {
      assert.equal(discovery.next_offset, null, 'Empty discovery cannot have another page');
      return {stored_runs: 'empty', seed: 'absent', events: 0, predictions: 0, joined_actuals: 0, measurement_count: null, sse: 'not_applicable_empty'};
    }
    snapshot = await (await read(`/api/v1/runs/${encodeURIComponent(selected.run_id)}?tester_id=${encodeURIComponent(selected.tester_id)}`)).json();
  }
  const path = `/api/v1/runs/${encodeURIComponent(selected.run_id)}`;
  const query = `?tester_id=${encodeURIComponent(selected.tester_id)}`;
  assert.equal(snapshot.run.run_id, selected.run_id);
  assert.equal(snapshot.run.tester_id, selected.tester_id);
  assert.equal(snapshot.run.mode, selected.mode);
  assert.ok(Array.isArray(snapshot.events), 'Scoped snapshot events');
  assert.ok(snapshot.events.every(event => event.run_id === selected.run_id && event.tester_id === selected.tester_id && event.source_mode === selected.mode), 'Snapshot event scope');
  const predictions = snapshot.events.filter(event => event.type === 'prediction');
  let measurementCount = null;
  if (seedPresent) {
    assert.equal(predictions.length, 24);
    assert.ok(predictions.every(event => Number.isFinite(event.actual) && event.unit === null && event.response_status === 'unknown' && !event.tester_receipt_id));
    const bundle = snapshot.events.find(event => event.message === 'Edge exporter event: device_completed');
    assert.ok(bundle, 'Replay measurement bundle');
    const measurements = await (await read(`${path}/measurements${query}&event_id=${encodeURIComponent(bundle.event_id)}&limit=100`)).json();
    assert.ok(measurements.total > 0);
    assert.ok(Array.isArray(measurements.measurements) && measurements.measurements.length > 0);
    assert.ok(measurements.measurements.every(measurement => measurement.unit === null));
    measurementCount = measurements.total;
  }
  const stream = await read(`${path}/events${query}`);
  assert.match(stream.headers.get('content-type'), /text[/]event-stream/);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ready;
  try {
    while (!ready) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, {stream: true});
      assert.ok(buffer.length < 100_000, 'Bounded SSE ready frame');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (/^event: ready$/m.test(frame)) {
          ready = JSON.parse(frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'));
          break;
        }
      }
    }
    assert.ok(ready, 'SSE ready frame');
    assert.equal(ready.run_id, selected.run_id);
    assert.equal(ready.tester_id, selected.tester_id);
  } finally { await reader.cancel(); }
  return {stored_runs: 'available', seed: seedPresent ? 'verified' : 'absent', run_id: selected.run_id, tester_id: selected.tester_id, mode: selected.mode, events: snapshot.events.length, predictions: predictions.length, joined_actuals: predictions.filter(event => Number.isFinite(event.actual)).length, measurement_count: measurementCount, sse: 'ready'};
}

async function main() {
const origin = process.argv[2] || 'http://127.0.0.1:5173';
const expectedAi = process.argv.includes('--expect-ai');
const publicOrigin = process.argv.find(arg => arg.startsWith('--public-origin='))?.slice('--public-origin='.length);
async function read(path, statuses = [200]) {
  const response = await fetch(new URL(path, origin), {signal: AbortSignal.timeout(20000)});
  assert.ok(statuses.includes(response.status), `${path}: HTTP ${response.status}`);
  return response;
}
if (process.argv.includes('--backend-only')) {
  console.log(JSON.stringify({origin, ...await verifyStoredRuns(read), paid_ai_calls: 0}));
  return;
}
const assets = new Set();
for (const path of ['/', '/workspace', '/replay', '/sandbox']) {
  const html = await (await read(path)).text();
  assert.match(html, /RTDI/);
  // Workspace restores the browser-tab source before rendering its controls.
  // Check that intentional SSR shell here; hydrated controls need a browser check.
  if (path === '/' || path === '/workspace') {
    assert.match(html, /aria-busy="true"/, `${path}: source-restoration shell`);
    assert.match(html, /Restoring selected source/, `${path}: source-restoration status`);
  } else {
    assert.match(html, /theme-selector/, `${path}: deployed theme control`);
  }
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    if (match[1].startsWith('/')) assets.add(match[1]);
  }
}
assert.ok(assets.size > 0, 'Built assets referenced in HTML');
for (const path of assets) {
  const response = await read(path);
  assert.match(response.headers.get('content-type'), /javascript|text[/]css/);
  await response.arrayBuffer();
}
await read('/replay/summary.json');
const config = await (await read('/api/config')).json();
assert.equal(config.backend_connected, true);
assert.equal(config.openai_configured, expectedAi);
assert.equal(config.commands_configured, false);
const stored = await verifyStoredRuns(read);
const originChecks = [];
if (publicOrigin) {
  for (const path of ['/api/assistant', '/api/v1/runs/grp6-replay-demo/chat']) {
    for (const [requestOrigin, expected] of [[publicOrigin, 400], ['https://untrusted.invalid', 403]]) {
      // Invalid body must fail before key lookup, model requests or persistence.
      const response = await fetch(new URL(path, origin), { method: 'POST', headers: {
        Origin: requestOrigin, 'Content-Type': 'application/json',
      }, body: '{}', signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, expected, `${path}: origin guard`);
      await response.json();
      originChecks.push({path, request_origin: requestOrigin, status: response.status});
    }
  }
}
console.log(JSON.stringify({origin, homepage:200, replay:200, assets:assets.size, ...stored, ai:config.openai_configured, commands:false, origin_checks:originChecks, paid_ai_calls:0}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
