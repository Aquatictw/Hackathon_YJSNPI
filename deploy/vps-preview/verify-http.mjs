// Run on the VPS using its isolated Node runtime after activation/recovery.
import assert from 'node:assert/strict';
const origin = process.argv[2] || 'http://127.0.0.1:5173';
async function read(path) {
  const response = await fetch(new URL(path, origin), {signal: AbortSignal.timeout(20000)});
  assert.equal(response.status, 200, path);
  return response;
}
const assets = new Set();
for (const path of ['/', '/replay']) {
  const html = await (await read(path)).text();
  assert.match(html, /RTDI/);
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
assert.equal(config.openai_configured, false);
assert.equal(config.commands_configured, false);
const snapshot = await (await read('/api/v1/runs/grp6-replay-demo?tester_id=grp6-replay')).json();
assert.equal(snapshot.run.mode, 'replay');
assert.equal(snapshot.run.tester_id, 'grp6-replay');
assert.ok(snapshot.events.length > 0);
const stream = await read('/api/v1/runs/grp6-replay-demo/events?tester_id=grp6-replay');
assert.match(stream.headers.get('content-type'), /text[/]event-stream/);
const reader = stream.body.getReader();
const {value} = await reader.read();
assert.match(new TextDecoder().decode(value), /event: ready/);
await reader.cancel();
console.log(JSON.stringify({origin, homepage:200, replay:200, assets:assets.size, events:snapshot.events.length, mode:snapshot.run.mode, sse:'ready', ai:false, commands:false}));
