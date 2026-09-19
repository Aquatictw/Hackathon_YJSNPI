import test from 'node:test';
import assert from 'node:assert/strict';
import {backendConnection, isHostRelay, sourceAge, sourceAgeHeading, sourceAgeLabel, storedSourceStatus} from '../lib/rtdi/connection-status.ts';

const now = Date.parse('2026-09-20T10:00:00Z');
const source = {mode:'replay', edge_id:'grp6-recorded-capture', last_event_at:'2026-09-20T09:00:00Z'};
test('host relay provenance does not grant current tester health or relabel recorded inputs', () => {
  const relay={...source,mode:'live',edge_id:'grp6-hc-relay'};
  assert.equal(isHostRelay(relay),true);
  assert.match(storedSourceStatus(relay,'en').label,/Gemini.*Host log relay/);
  assert.match(storedSourceStatus(relay,'en').note,/completed runs.*source time/);
  assert.equal(sourceAge(relay.last_event_at,now).ageMs,3600000);
  assert.equal(isHostRelay({...relay,mode:'replay'}),false);
  assert.equal(isHostRelay({...relay,mode:'simulation'}),false);
  assert.equal(isHostRelay(null),false);
});

test('source age parses timezone-qualified original source timestamps, retaining seconds and offsets', () => {
  for (const value of ['2026-09-20T09:00:00Z','2026-09-20T17:00:00+08:00','2026-09-20T04:00:00-05:00']) {
    assert.deepEqual(sourceAge(value, now), {state:'dated', timestamp:'2026-09-20T09:00:00.000Z', ageMs:3_600_000});
  }
  assert.equal(sourceAge('2026-09-20T09:59:59.125Z',now).ageMs,875);
  assert.equal(sourceAge('2026-09-20T10:00:00Z',now).ageMs,0);
});

test('missing, invalid and timezone-free dates cannot imply freshness', () => {
  for (const value of ['', 'bad','2026-09-20','2026-09-20T09:00:00','2026-99-99T09:00:00Z']) {
    assert.equal(sourceAge(value,now).state,'unknown');
    assert.match(sourceAgeLabel(sourceAge(value,now),'en'),/Freshness unknown/);
  }
  assert.equal(sourceAge(source.last_event_at,NaN).state,'unknown');
});

test('future timestamps remain unverified rather than clamped to fresh', () => {
  const age=sourceAge('2026-09-20T10:01:00Z',now);
  assert.equal(age.state,'future');assert.equal(age.ageMs,null);
  assert.match(sourceAgeLabel(age,'en'),/ahead of browser clock.*unverified/);
});

test('displayed age advances without a new source event, independent of SSE', () => {
  assert.equal(sourceAgeLabel(sourceAge(source.last_event_at,now),'en'),'1 hour ago');
  assert.equal(sourceAgeLabel(sourceAge(source.last_event_at,now+86_400_000),'en'),'1 day ago');
  assert.equal(sourceAgeLabel(sourceAge(source.last_event_at,Date.parse(source.last_event_at)+30_000),'en'),'Less than 1 minute ago');
  assert.match(sourceAgeLabel(sourceAge(source.last_event_at,now),'zh-TW'),/1.*小時前/);
});

test('recorded Gemini provenance preserves original time semantics without claiming a feed', () => {
  for(const locale of ['en','zh-TW']) {
    const provenance=storedSourceStatus(source,locale);
    assert.match(provenance.label,/RECORDED.*Gemini.*REPLAY/);
    assert.doesNotMatch(provenance.note,/ordering|匯入順序/);
  }
  assert.match(storedSourceStatus(source,'en').note,/original machine event timestamps.*not a current feed/);
  assert.equal(sourceAgeHeading(source,'en'),'Original machine event age');
  const replay={...source,edge_id:'grp6-replay-exporter'};
  assert.match(storedSourceStatus(replay,'en').note,/import ordering/);
  assert.equal(sourceAgeHeading(replay,'en'),'Replay ordering age');
});

test('unknown replay edges and missing edge ID do not inherit synthetic or recorded provenance', () => {
  for(const edge_id of [undefined,'another-edge']) {
    const replay={...source,edge_id};
    assert.match(storedSourceStatus(replay,'en').note,/provenance is unverified/);
    assert.doesNotMatch(storedSourceStatus(replay,'en').note,/ordering|original machine/);
  }
  assert.doesNotMatch(storedSourceStatus({...source,mode:'live'},'en').label,/RECORDED/);
  assert.match(storedSourceStatus({...source,mode:'live'},'en').note,/do not establish a current machine connection/);
  assert.match(storedSourceStatus({...source,mode:'simulation'},'en').label,/Synthetic/);
  assert.equal(storedSourceStatus(null,'en').label,'No run loaded');
});

test('SSE connection labels refer only to the backend, including failure and unknown states', () => {
  for(const status of ['Not connected','Connecting','Snapshot loaded','Event stream connected','Reconnecting · Showing last snapshot','Event stream interrupted · Waiting to reconnect','Snapshot refresh failed','Connection failed','Disconnected · Showing last snapshot','Unexpected state']) {
    for(const locale of ['en','zh-TW']) {
      const connection=backendConnection(status,locale);
      assert.equal(connection.connected,status==='Event stream connected');
      assert.match(connection.label,locale==='en'?/Backend/:/後端/);
      assert.doesNotMatch(connection.label,/Gemini|telemetry online|機台已連線/);
    }
  }
});
