#!/usr/bin/env node
// Run on the preview host. Keep the ingest secret in its existing private file.
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [batchesPath, manifestPath] = process.argv.slice(2);
if (!batchesPath || !manifestPath) throw Error('Usage: import-recorded.mjs <batches.json> <catalog.json>');
const release = await realpath('/opt/grp6-preview/current');
const { ingestRecordedCatalog, sha256 } = await import(pathToFileURL(resolve(release, 'frontend/scripts/import-recorded-captures.mjs')));
const vars = await readFile('/opt/grp6-preview/shared/.dev.vars', 'utf8');
const tokenLine = vars.split(/\r?\n/).find(line => /^INGEST_TOKEN\s*=/.test(line));
if (!tokenLine) throw Error('Preview ingest credential is not configured.');
let token = tokenLine.slice(tokenLine.indexOf('=') + 1).trim();
if (token.startsWith('"')) token = JSON.parse(token);
else if (token.startsWith("'")) token = token.slice(1, -1);
const batches = JSON.parse(await readFile(batchesPath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (sha256(JSON.stringify(batches)) !== manifest.batches_sha256) throw Error('Catalog/batch checksum mismatch.');
const result = await ingestRecordedCatalog({ batches, manifest }, {
  endpoint: 'http://127.0.0.1:5173/api/v1/events/batch', token,
});
console.log(JSON.stringify({ ...result, runs: manifest.runs.map(run => ({ run_id: run.run_id, tester_id: run.tester_id })),
  mode: 'recorded', transport: 'preview-loopback', paid_ai_calls: 0 }));
