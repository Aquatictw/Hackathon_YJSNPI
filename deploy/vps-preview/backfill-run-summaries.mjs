#!/usr/bin/env node
// Node >=22.18, with the release's frontend dependencies installed. No network I/O.
// Default: node deploy/vps-preview/backfill-run-summaries.mjs --db /local/path.sqlite
// Apply:   repeat with --apply. Stop the local writer or take a SQLite-safe backup first.
import { DatabaseSync } from 'node:sqlite';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeExporterBatch } from '../../frontend/lib/rtdi/exporter-wire.ts';
import { canonicalJson, contentHash, edgeRecordSchema } from '../../frontend/lib/rtdi/wire.ts';
import { decodeUtf8Base64Chunks } from '../../frontend/lib/rtdi/raw-payload.ts';

function requireLocalPath(value) {
  const normalized = typeof value === 'string' ? value.replaceAll(String.fromCharCode(92), '/') : '';
  if (!normalized || normalized === ':memory:' ||
      /^[a-z][a-z0-9+.-]*:/i.test(normalized.replace(/^[a-z]:[/]/i, '')) ||
      normalized.startsWith('//')) {
    throw new Error('--db must name an existing local SQLite file, not a URL or network path');
  }
  const path = realpathSync(resolve(value));
  if (path.replaceAll(String.fromCharCode(92), '/').startsWith('//') || !statSync(path).isFile()) {
    throw new Error('--db must name a local file');
  }
  return path;
}

function check(condition, key, message) {
  if (!condition) throw new Error(`${key}: ${message}; no repairs committed`);
}

/** Add only missing validated yield/count fields. Source hashes identify raw data,
 * so payload_hash, rowid/SSE cursor, timestamps and all other tables stay intact.
 * All candidates are validated before the first UPDATE, under one transaction. */
export async function backfillRunSummaries({ dbPath, apply = false }) {
  if (typeof apply !== 'boolean') throw new Error('apply must be a boolean');
  const path = requireLocalPath(dbPath);
  const db = new DatabaseSync(path, { readOnly: !apply });
  let transaction = false;
  try {
    db.exec(apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
    transaction = true;
    const sources = db.prepare("SELECT * FROM raw_events WHERE event_type = 'run_summary' ORDER BY key").all();
    const readEvent = db.prepare('SELECT * FROM events WHERE key = ?');
    const readChunks = db.prepare('SELECT * FROM raw_event_chunks WHERE event_key = ? ORDER BY chunk_index');
    const repairs = [];
    for (const source of sources) {
      const key = source.key;
      const row = readEvent.get(key);
      check(row, key, 'missing normalized event');
      const chunks = readChunks.all(key);
      check(Number.isSafeInteger(source.chunk_count) && source.chunk_count > 0 &&
        chunks.length === source.chunk_count, key, 'raw chunk count mismatch');
      check(chunks.every((chunk, index) => chunk.chunk_index === index &&
        chunk.key === JSON.stringify([key, String(index)])), key, 'raw chunk identity/order mismatch');
      const rawText = decodeUtf8Base64Chunks(chunks.map(chunk => chunk.payload_base64));
      check(Buffer.byteLength(rawText, 'utf8') === source.payload_bytes, key, 'raw byte length mismatch');
      const raw = JSON.parse(rawText);
      const hash = await contentHash(raw);
      check(hash === source.payload_hash && hash === row.payload_hash, key, 'raw hash mismatch');
      check(raw.event_type === 'run_summary', key, 'raw event type mismatch');
      const expected = normalizeExporterBatch({
        schema_version: 1, edge_id: source.edge_id, batch_id: 'local-summary-repair', events: [raw],
      }).batch.events[0];
      const existing = edgeRecordSchema.parse(JSON.parse(row.payload));
      check(key === JSON.stringify([expected.run_id, expected.tester_id, expected.event_id]), key, 'scoped key mismatch');
      for (const field of ['event_id', 'run_id', 'tester_id']) {
        check(source[field] === expected[field] && row[field] === expected[field] &&
          existing[field] === expected[field], key, `${field} mismatch`);
      }
      check(source.edge_id === row.edge_id, key, 'edge identity mismatch');
      for (const [column, field] of [
        ['type', 'type'], ['mode', 'source_mode'], ['occurred_at', 'timestamp'],
        ['sequence', 'sequence'], ['lot_id', 'lot_id'], ['wafer_id', 'wafer_id'], ['site_id', 'site_id'],
      ]) {
        check((row[column] ?? null) === (expected[field] ?? null) &&
          (existing[field] ?? null) === (expected[field] ?? null), key, `${field} mismatch`);
      }
      const additions = {};
      for (const field of ['completed_devices', 'yield']) {
        // Never overwrite a projection disagreement, even if the raw value is valid.
        check(existing[field] === undefined || existing[field] === expected[field], key, `${field} projection conflict`);
        if (existing[field] === undefined && expected[field] !== undefined) additions[field] = expected[field];
      }
      if (Object.keys(additions).length) {
        const payload = canonicalJson(edgeRecordSchema.parse({ ...existing, ...additions }));
        repairs.push({ key, before: row.payload, payload, fields: Object.keys(additions) });
      }
    }
    if (apply) {
      const update = db.prepare('UPDATE events SET payload = ? WHERE key = ? AND payload = ?');
      for (const repair of repairs) {
        check(update.run(repair.payload, repair.key, repair.before).changes === 1, repair.key, 'concurrent projection change');
      }
    }
    db.exec('COMMIT');
    transaction = false;
    return {
      database: path, mode: apply ? 'apply' : 'dry-run', scanned: sources.length,
      eligible: repairs.length, updated: apply ? repairs.length : 0,
      repairs: repairs.map(({ key, fields }) => ({ key, fields })),
    };
  } catch (error) {
    if (transaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

export function parseArgs(args) {
  let dbPath;
  let mode;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--db' && dbPath === undefined && args[index + 1] && !args[index + 1].startsWith('--')) {
      dbPath = args[++index];
    } else if ((arg === '--apply' || arg === '--dry-run') && mode === undefined) {
      mode = arg;
    } else {
      throw new Error(`Unknown, duplicate or conflicting argument: ${arg}`);
    }
  }
  if (!dbPath) throw new Error('Usage: backfill-run-summaries.mjs --db <existing-local.sqlite> [--dry-run | --apply]');
  return { dbPath, apply: mode === '--apply' };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await backfillRunSummaries(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`Run-summary repair failed: ${error.message}`);
    process.exitCode = 1;
  }
}
