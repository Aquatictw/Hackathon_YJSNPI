import {createHash} from 'node:crypto';
import {normalizeExporterBatch} from '../lib/rtdi/exporter-wire.ts';
import {projectExporterEvents} from '../lib/rtdi/backend-projection.ts';

export async function predictionSeedBatches(text) {
  const events = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  if (!events.length || events.length > 100) throw Error('Preview seed must contain 1–100 events.');
  if (events.some(e => e.mode !== 'replay' || e.run_id !== 'grp6-replay-demo' || e.tester_id !== 'grp6-replay'))
    throw Error('Preview seed must remain in the dedicated replay scope.');
  const hash = createHash('sha256').update(JSON.stringify(events)).digest('hex');
  const batch = {schema_version:1, edge_id:'grp6-replay-exporter', batch_id:`preview-predictions-${hash}`, events};
  const normalized = normalizeExporterBatch(batch);
  await projectExporterEvents(normalized.rawEvents, normalized.batch.events);
  return [batch];
}

export function validateSeedAck(batch, body) {
  const expected = new Set(batch.events.map(event => event.event_id));
  if (!body || !Array.isArray(body.accepted) || !Array.isArray(body.duplicates) || !Array.isArray(body.rejected) || body.rejected.length)
    throw Error('Seed ingest did not fully acknowledge the batch.');
  const acknowledged = [...body.accepted, ...body.duplicates];
  if (expected.size !== batch.events.length || acknowledged.length !== expected.size ||
      new Set(acknowledged).size !== expected.size || acknowledged.some(id => !expected.has(id)))
    throw Error('Seed ingest acknowledgement IDs do not match the batch.');
}
