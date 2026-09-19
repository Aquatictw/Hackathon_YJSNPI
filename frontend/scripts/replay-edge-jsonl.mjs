#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { replayJsonlToEdgeBatches } from '../lib/rtdi/replay-adapter.ts';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  if (!name?.startsWith('--')) throw new Error(`Unknown argument: ${name}`);
  args.set(name.slice(2), process.argv[index + 1]);
}

const input = resolve(args.get('input') ?? '../results/replay/replay.jsonl');
const options = {
  edgeId: args.get('edge-id') ?? 'grp6-replay-exporter',
  runId: args.get('run-id') ?? `grp6-replay-${new Date().toISOString().slice(0, 10)}`,
  testerId: args.get('tester-id') ?? 'grp6-replay',
  startedAt: args.get('started-at') ?? new Date().toISOString(),
};
const lines = (await readFile(input, 'utf8')).split(/\r?\n/);
const batches = await replayJsonlToEdgeBatches(lines, options);
const output = args.get('output');
if (output) await writeFile(resolve(output), `${JSON.stringify(batches, null, 2)}\n`, 'utf8');

const endpoint = args.get('endpoint');
const token = args.get('token') ?? process.env.INGEST_TOKEN;
if (endpoint) {
  if (!token) throw new Error('Provide --token or INGEST_TOKEN when --endpoint is used.');
  for (const batch of batches) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Batch ${batch.batch_id} failed (${response.status}): ${body.slice(0, 500)}`);
    process.stdout.write(`${batch.batch_id}: ${body}\n`);
  }
} else {
  const eventCount = batches.reduce((total, batch) => total + batch.events.length, 0);
  process.stdout.write(`Validated ${eventCount} replay events in ${batches.length} Edge v1 batch(es).\n`);
  if (output) process.stdout.write(`Wrote ${resolve(output)}\n`);
}
