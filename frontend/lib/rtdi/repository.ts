import { env } from "cloudflare:workers";
import { canApplyCommandStatus, type CommandResultInput, type CreateCommandInput } from "./command-contract";
import type { RawExporterEvent } from "./exporter-wire";
import { chunkUtf8Base64 } from "./raw-payload";
import { canonicalJson, contentHash, type EdgeBatch, type EdgeRecord } from "./wire";

type Row = Record<string, unknown>;

export class StorageUnavailableError extends Error {}
export class IdentityConflictError extends Error {
  constructor(message: string, readonly ids: string[] = []) { super(message); }
}
export class AmbiguousScopeError extends Error {}
export class InvalidCommandError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export type IngestResult = {
  batch_id: string;
  accepted: string[];
  duplicates: string[];
  rejected: Array<{ event_id: string; reason: string }>;
  status: "stored" | "duplicate";
};

export type RunSnapshot = {
  run: {
    run_id: string;
    tester_id: string;
    edge_id: string;
    mode: string;
    lot_id: string | null;
    wafer_id: string | null;
    data_quality: string;
    last_event_at: string;
  };
  events: EdgeRecord[];
  evidence: EdgeRecord[];
  incidents: Array<{
    incident_id: string;
    title: string;
    status: string;
    severity: string;
    first_seen: string;
    last_seen: string;
  }>;
  commands: CommandView[];
};

export type CommandView = {
  command_id: string;
  run_id: string;
  tester_id: string;
  incident_id: string;
  kind: string;
  message: string;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type RunEventUpdate = { cursor: number; event: EdgeRecord };

const scopeKey = (...parts: string[]) => JSON.stringify(parts);
const binding = (): D1Database => {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new StorageUnavailableError("D1 binding DB is unavailable");
  return db;
};
const rows = <T extends Row>(result: D1Result<T>): T[] => result.results ?? [];
const parsePayload = (value: unknown): EdgeRecord => JSON.parse(String(value)) as EdgeRecord;
const commandView = (row: Row): CommandView => ({
  command_id: String(row.command_id), run_id: String(row.run_id), tester_id: String(row.tester_id),
  incident_id: String(row.incident_id), kind: String(row.kind), message: String(row.message), status: String(row.status),
  expires_at: String(row.expires_at), created_at: String(row.created_at), updated_at: String(row.updated_at),
});

export async function ingestEdgeBatch(batch: EdgeBatch, options: { identityPayload?: unknown; rawEvents?: RawExporterEvent[] } = {}): Promise<IngestResult> {
  const db = binding();
  const batchKey = scopeKey(batch.edge_id, batch.batch_id);
  const batchHash = await contentHash(options.identityPayload ?? batch);
  const existingBatch = await db.prepare("SELECT payload_hash FROM batches WHERE key = ?").bind(batchKey).first<{ payload_hash: string }>();
  if (existingBatch) {
    if (existingBatch.payload_hash !== batchHash) throw new IdentityConflictError("batch_id already exists with different content", [batch.batch_id]);
    return { batch_id: batch.batch_id, accepted: [], duplicates: batch.events.map(event => event.event_id), rejected: [], status: "duplicate" };
  }

  const rawByKey = new Map((options.rawEvents ?? []).map(raw => [scopeKey(raw.run_id, raw.tester_id, raw.event_id), raw]));
  const prepared = await Promise.all(batch.events.map(async event => {
    const key = scopeKey(event.run_id, event.tester_id, event.event_id);
    const raw = rawByKey.get(key);
    return {
      event,
      key,
      raw,
      hash: await contentHash(raw?.payload ?? event),
      payload: canonicalJson(event),
    };
  }));
  const existingResults = await db.batch(prepared.map(item => db.prepare("SELECT payload_hash FROM events WHERE key = ?").bind(item.key)));
  const accepted: typeof prepared = [];
  const duplicates: string[] = [];
  const conflicts: string[] = [];
  prepared.forEach((item, index) => {
    const existing = rows(existingResults[index] as D1Result<{ payload_hash: string }>)[0];
    if (!existing) accepted.push(item);
    else if (existing.payload_hash === item.hash) duplicates.push(item.event.event_id);
    else conflicts.push(item.event.event_id);
  });
  const incomingEvidence = accepted.filter(item => item.event.type === "evidence" && item.event.evidence_id);
  if (incomingEvidence.length) {
    const existingEvidence = await db.batch(incomingEvidence.map(item => db.prepare("SELECT evidence_id FROM evidence WHERE key = ?")
      .bind(scopeKey(item.event.run_id, item.event.tester_id, item.event.evidence_id!))));
    existingEvidence.forEach((result, index) => {
      if (rows(result as D1Result<{ evidence_id: string }>).length) conflicts.push(incomingEvidence[index].event.evidence_id!);
    });
  }
  if (conflicts.length) throw new IdentityConflictError("event or evidence identity already exists with conflicting content", conflicts);

  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO batches (key, edge_id, batch_id, payload_hash) VALUES (?, ?, ?, ?)").bind(batchKey, batch.edge_id, batch.batch_id, batchHash),
  ];
  for (const item of accepted) {
    const event = item.event;
    const runKey = scopeKey(event.run_id, event.tester_id);
    const quality = event.data_quality ?? (event.lot_id && event.wafer_id ? "complete" : "partial");
    if (item.raw) {
      const rawPayload = canonicalJson(item.raw.payload);
      const chunked = chunkUtf8Base64(rawPayload);
      statements.push(db.prepare(`INSERT INTO raw_events
        (key, event_id, run_id, tester_id, edge_id, event_type, payload_hash, payload_bytes, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(item.key, event.event_id, event.run_id, event.tester_id, batch.edge_id, item.raw.event_type,
          item.hash, chunked.byteLength, chunked.chunks.length));
      chunked.chunks.forEach((payloadBase64, index) => {
        statements.push(db.prepare(`INSERT INTO raw_event_chunks (key, event_key, chunk_index, payload_base64)
          VALUES (?, ?, ?, ?)`)
          .bind(scopeKey(item.key, String(index)), item.key, index, payloadBase64));
      });
    }
    statements.push(db.prepare(`
      INSERT INTO runs (key, run_id, tester_id, edge_id, mode, lot_id, wafer_id, data_quality, last_event_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        edge_id = excluded.edge_id,
        mode = CASE WHEN runs.mode = 'live' THEN runs.mode ELSE excluded.mode END,
        lot_id = COALESCE(excluded.lot_id, runs.lot_id),
        wafer_id = COALESCE(excluded.wafer_id, runs.wafer_id),
        data_quality = CASE WHEN runs.data_quality = 'partial' OR excluded.data_quality = 'partial' THEN 'partial' ELSE 'complete' END,
        last_event_at = MAX(runs.last_event_at, excluded.last_event_at),
        updated_at = CURRENT_TIMESTAMP
    `).bind(runKey, event.run_id, event.tester_id, batch.edge_id, event.source_mode, event.lot_id ?? null, event.wafer_id ?? null, quality, event.timestamp));
    statements.push(db.prepare(`
      INSERT INTO events (
        key, event_id, batch_key, edge_id, run_id, tester_id, lot_id, wafer_id, site_id,
        type, mode, occurred_at, sequence, incident_id, evidence_id, payload_hash, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(item.key, event.event_id, batchKey, batch.edge_id, event.run_id, event.tester_id, event.lot_id ?? null,
      event.wafer_id ?? null, event.site_id ?? null, event.type, event.source_mode, event.timestamp, event.sequence ?? null,
      event.incident_id ?? null, event.evidence_id ?? null, item.hash, item.payload));

    if (event.type === "evidence" && event.evidence_id) {
      const evidenceKey = scopeKey(event.run_id, event.tester_id, event.evidence_id);
      statements.push(db.prepare(`
        INSERT INTO evidence (
          key, evidence_id, event_key, run_id, tester_id, incident_id, site_id, test_name,
          kind, sample_count, observed, baseline, score, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(evidenceKey, event.evidence_id, item.key, event.run_id, event.tester_id, event.incident_id ?? null,
        event.site_id ?? null, event.test_name ?? event.affected_tests?.[0] ?? null, event.kind ?? null,
        event.sample_count ?? 0, event.current_value ?? event.value ?? null, event.baseline ?? null, event.score ?? null, item.payload));
    }
    if (event.incident_id) {
      const incidentKey = scopeKey(event.run_id, event.tester_id, event.incident_id);
      statements.push(db.prepare(`
        INSERT INTO incidents (key, incident_id, run_id, tester_id, title, status, severity, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          title = excluded.title,
          severity = CASE WHEN excluded.severity = 'critical' THEN 'critical' ELSE incidents.severity END,
          last_seen = MAX(incidents.last_seen, excluded.last_seen),
          updated_at = CURRENT_TIMESTAMP
      `).bind(incidentKey, event.incident_id, event.run_id, event.tester_id,
        event.message || event.kind || "未分類異常", event.severity ?? "warning", event.timestamp, event.timestamp));
    }
  }
  await db.batch(statements);
  return { batch_id: batch.batch_id, accepted: accepted.map(item => item.event.event_id), duplicates, rejected: [], status: "stored" };
}

export async function getRunSnapshot(runId: string, testerId?: string | null): Promise<RunSnapshot | null> {
  const db = binding();
  const runResult = testerId
    ? await db.prepare("SELECT * FROM runs WHERE run_id = ? AND tester_id = ? ORDER BY updated_at DESC").bind(runId, testerId).all<Row>()
    : await db.prepare("SELECT * FROM runs WHERE run_id = ? ORDER BY updated_at DESC").bind(runId).all<Row>();
  const matches = rows(runResult);
  if (!matches.length) return null;
  if (matches.length > 1) throw new AmbiguousScopeError("run_id exists for multiple testers; provide tester_id");
  const run = matches[0];
  const selectedTester = String(run.tester_id);
  const [eventResult, incidentResult, commandResult] = await db.batch([
    db.prepare("SELECT payload FROM events WHERE run_id = ? AND tester_id = ? ORDER BY occurred_at, sequence, event_id").bind(runId, selectedTester),
    db.prepare("SELECT incident_id, title, status, severity, first_seen, last_seen FROM incidents WHERE run_id = ? AND tester_id = ? ORDER BY last_seen DESC").bind(runId, selectedTester),
    db.prepare("SELECT command_id, run_id, tester_id, incident_id, kind, message, status, expires_at, created_at, updated_at FROM commands WHERE run_id = ? AND tester_id = ? ORDER BY created_at DESC").bind(runId, selectedTester),
  ]);
  const eventRows = rows(eventResult as D1Result<Row>);
  const incidentRows = rows(incidentResult as D1Result<Row>);
  const commandRows = rows(commandResult as D1Result<Row>);
  const eventRecords = eventRows.map(row => parsePayload(row.payload));
  return {
    run: {
      run_id: String(run.run_id), tester_id: selectedTester, edge_id: String(run.edge_id), mode: String(run.mode),
      lot_id: run.lot_id == null ? null : String(run.lot_id), wafer_id: run.wafer_id == null ? null : String(run.wafer_id),
      data_quality: String(run.data_quality), last_event_at: String(run.last_event_at),
    },
    events: eventRecords,
    evidence: eventRecords.filter(event => event.type === "evidence"),
    incidents: incidentRows.map(row => ({
      incident_id: String(row.incident_id), title: String(row.title), status: String(row.status), severity: String(row.severity),
      first_seen: String(row.first_seen), last_seen: String(row.last_seen),
    })),
    commands: commandRows.map(commandView),
  };
}

export async function getRunEventUpdates(runId: string, testerId: string | null, after: number, limit = 100): Promise<{ tester_id: string; cursor: number; updates: RunEventUpdate[] } | null> {
  const db = binding();
  const runResult = testerId
    ? await db.prepare("SELECT tester_id FROM runs WHERE run_id = ? AND tester_id = ?").bind(runId, testerId).all<Row>()
    : await db.prepare("SELECT tester_id FROM runs WHERE run_id = ? ORDER BY updated_at DESC").bind(runId).all<Row>();
  const matches = rows(runResult);
  if (!matches.length) return null;
  if (matches.length > 1) throw new AmbiguousScopeError("run_id exists for multiple testers; provide tester_id");
  const selectedTester = String(matches[0].tester_id);
  const result = await db.prepare(`SELECT rowid AS cursor, payload FROM events
    WHERE run_id = ? AND tester_id = ? AND rowid > ? ORDER BY rowid LIMIT ?`)
    .bind(runId, selectedTester, after, Math.min(Math.max(limit, 1), 100)).all<Row>();
  const updates = rows(result).map(row => ({ cursor: Number(row.cursor), event: parsePayload(row.payload) }));
  return { tester_id: selectedTester, cursor: updates.at(-1)?.cursor ?? after, updates };
}

export async function createRunCommand(runId: string, testerId: string | null, input: CreateCommandInput): Promise<{ command: CommandView; status: "queued" | "duplicate" }> {
  const db = binding();
  const runResult = testerId
    ? await db.prepare("SELECT * FROM runs WHERE run_id = ? AND tester_id = ?").bind(runId, testerId).all<Row>()
    : await db.prepare("SELECT * FROM runs WHERE run_id = ? ORDER BY updated_at DESC").bind(runId).all<Row>();
  const runMatches = rows(runResult);
  if (!runMatches.length) throw new InvalidCommandError("找不到指定 run。", "run_not_found");
  if (runMatches.length > 1) throw new AmbiguousScopeError("run_id exists for multiple testers; provide tester_id");
  const run = runMatches[0];
  if (String(run.mode) !== "live") throw new InvalidCommandError("只有已驗證為 live 的 run 可以建立機台訊息。", "non_live_run");
  const selectedTester = String(run.tester_id);
  const incident = await db.prepare("SELECT incident_id FROM incidents WHERE run_id = ? AND tester_id = ? AND incident_id = ?")
    .bind(runId, selectedTester, input.incident_id).first<Row>();
  if (!incident) throw new InvalidCommandError("找不到此 run 的 incident。", "incident_not_found");

  const payloadHash = await contentHash({ run_id: runId, tester_id: selectedTester, ...input });
  const existing = await db.prepare("SELECT * FROM commands WHERE command_id = ?").bind(input.request_id).first<Row>();
  if (existing) {
    if (String(existing.payload_hash) !== payloadHash) throw new IdentityConflictError("request_id already exists with different command content", [input.request_id]);
    return { command: commandView(existing), status: "duplicate" };
  }
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + input.ttl_seconds * 1000).toISOString();
  await db.prepare(`INSERT INTO commands
    (command_id, run_id, tester_id, incident_id, kind, message, status, expires_at, payload_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`)
    .bind(input.request_id, runId, selectedTester, input.incident_id, input.kind, input.message, expiresAt, payloadHash, createdAt, createdAt).run();
  return { command: commandView({ command_id: input.request_id, run_id: runId, tester_id: selectedTester,
    incident_id: input.incident_id, kind: input.kind, message: input.message, status: "queued",
    expires_at: expiresAt, created_at: createdAt, updated_at: createdAt }), status: "queued" };
}

export async function getPendingCommands(testerId: string, runId?: string | null): Promise<CommandView[]> {
  const db = binding();
  const now = new Date().toISOString();
  await db.prepare(`UPDATE commands SET status = 'expired', updated_at = ?
    WHERE tester_id = ? AND status = 'queued' AND expires_at <= ?`).bind(now, testerId, now).run();
  const result = runId
    ? await db.prepare(`SELECT * FROM commands WHERE tester_id = ? AND run_id = ? AND status = 'queued' AND expires_at > ? ORDER BY created_at LIMIT 20`).bind(testerId, runId, now).all<Row>()
    : await db.prepare(`SELECT * FROM commands WHERE tester_id = ? AND status = 'queued' AND expires_at > ? ORDER BY created_at LIMIT 20`).bind(testerId, now).all<Row>();
  return rows(result).map(commandView);
}

export async function recordCommandResult(commandId: string, input: CommandResultInput): Promise<{ command_id: string; status: string; duplicate: boolean }> {
  const db = binding();
  const payloadHash = await contentHash(input);
  const existing = await db.prepare("SELECT command_id, payload_hash, status FROM command_results WHERE ack_id = ?").bind(input.ack_id).first<Row>();
  if (existing) {
    if (String(existing.command_id) !== commandId || String(existing.payload_hash) !== payloadHash) {
      throw new IdentityConflictError("ack_id already exists with different result content", [input.ack_id]);
    }
    return { command_id: commandId, status: String(existing.status), duplicate: true };
  }
  const command = await db.prepare("SELECT * FROM commands WHERE command_id = ?").bind(commandId).first<Row>();
  if (!command) throw new InvalidCommandError("找不到指定 command。", "command_not_found");
  if (String(command.run_id) !== input.run_id || String(command.tester_id) !== input.tester_id) {
    throw new InvalidCommandError("command result 的 run/tester 範圍不符。", "scope_mismatch");
  }
  const currentStatus = String(command.status);
  if (currentStatus === "queued" && input.status !== "expired" && Date.parse(input.occurred_at) > Date.parse(String(command.expires_at))) {
    throw new InvalidCommandError("command 已超過可下發期限。", "command_expired");
  }
  if (!canApplyCommandStatus(currentStatus, input.status)) {
    throw new InvalidCommandError(`command 狀態不可由 ${currentStatus} 變更為 ${input.status}。`, "invalid_transition");
  }
  await db.batch([
    db.prepare(`INSERT INTO command_results
      (ack_id, command_id, run_id, tester_id, status, tester_receipt_id, detail, occurred_at, payload_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.ack_id, commandId, input.run_id, input.tester_id, input.status, input.tester_receipt_id ?? null, input.detail, input.occurred_at, payloadHash),
    db.prepare("UPDATE commands SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE command_id = ?").bind(input.status, commandId),
  ]);
  return { command_id: commandId, status: input.status, duplicate: false };
}

export async function getIncident(incidentId: string, runId?: string | null): Promise<{ incident: RunSnapshot["incidents"][number]; evidence: EdgeRecord[]; run_id: string; tester_id: string } | null> {
  const db = binding();
  const result = runId
    ? await db.prepare("SELECT * FROM incidents WHERE incident_id = ? AND run_id = ? ORDER BY updated_at DESC").bind(incidentId, runId).all<Row>()
    : await db.prepare("SELECT * FROM incidents WHERE incident_id = ? ORDER BY updated_at DESC").bind(incidentId).all<Row>();
  const matches = rows(result);
  if (!matches.length) return null;
  if (matches.length > 1) throw new AmbiguousScopeError("incident_id is ambiguous; provide run_id");
  const incident = matches[0];
  const evidenceResult = await db.prepare("SELECT payload FROM evidence WHERE incident_id = ? AND run_id = ? AND tester_id = ? ORDER BY created_at")
    .bind(incidentId, incident.run_id, incident.tester_id).all<Row>();
  return {
    incident: {
      incident_id: String(incident.incident_id), title: String(incident.title), status: String(incident.status), severity: String(incident.severity),
      first_seen: String(incident.first_seen), last_seen: String(incident.last_seen),
    },
    evidence: rows(evidenceResult).map(row => parsePayload(row.payload)),
    run_id: String(incident.run_id), tester_id: String(incident.tester_id),
  };
}

export async function startInvestigation(input: { run_id: string; tester_id?: string | null; incident_id?: string | null; question: string; model: string }): Promise<string> {
  const db = binding();
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO investigations (investigation_id, run_id, tester_id, incident_id, question, status, model)
    VALUES (?, ?, ?, ?, ?, 'running', ?)`).bind(id, input.run_id, input.tester_id ?? null, input.incident_id ?? null, input.question, input.model).run();
  return id;
}

export async function finishInvestigation(id: string, result: { status: "complete" | "incomplete" | "failed"; answer?: string; evidence_ids?: string[]; tool_trace?: unknown[]; error?: string }): Promise<void> {
  const db = binding();
  await db.prepare(`UPDATE investigations SET status = ?, answer = ?, evidence_ids = ?, tool_trace = ?, error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE investigation_id = ?`).bind(result.status, result.answer ?? null, JSON.stringify(result.evidence_ids ?? []), JSON.stringify(result.tool_trace ?? []), result.error ?? null, id).run();
}
