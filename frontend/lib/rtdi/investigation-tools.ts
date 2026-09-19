import { z } from "zod";
import { getIncident, getRunSnapshot, type RunSnapshot } from "./repository";
import type { EventView } from "./contracts";
import type { EdgeRecord } from "./wire";
import type { ToolExecutor } from "./tool-contract";

const runArgs = z.object({ run_id: z.string().min(1).max(120), tester_id: z.string().min(1).max(120).nullable() }).strict();
const incidentArgs = z.object({ run_id: z.string().min(1).max(120), incident_id: z.string().min(1).max(120) }).strict();
const compareArgs = z.object({ run_id: z.string().min(1).max(120), tester_id: z.string().min(1).max(120).nullable(), incident_id: z.string().min(1).max(120).nullable() }).strict();

function summarize(snapshot: RunSnapshot) {
  const counts = snapshot.events.reduce<Record<string, number>>((result, event) => {
    result[event.type] = (result[event.type] ?? 0) + 1;
    return result;
  }, {});
  const evidenceIds = snapshot.evidence.flatMap(event => event.evidence_id ? [event.evidence_id] : []);
  return {
    run_id: snapshot.run.run_id,
    tester_id: snapshot.run.tester_id,
    source_mode: snapshot.run.mode,
    last_event_at: snapshot.run.last_event_at,
    data_quality: snapshot.run.data_quality,
    lot_id: snapshot.run.lot_id,
    wafer_id: snapshot.run.wafer_id,
    event_counts: counts,
    incident_count: snapshot.incidents.length,
    open_incidents: snapshot.incidents.filter(incident => incident.status !== "resolved").map(incident => incident.incident_id),
    evidence_ids: evidenceIds,
  };
}

function compareEvidence(records: EdgeRecord[], incidentId?: string | null) {
  const selected = records.filter(record => !incidentId || record.incident_id === incidentId);
  const bySite = new Map<string, { evidence_ids: string[]; sample_count: number; observed: number[]; baseline: number[]; series: number[]; tests: Set<string> }>();
  for (const record of selected) {
    const seriesSites = Object.keys(record.site_series ?? {});
    const sites = seriesSites.length ? seriesSites : record.site_ids?.length ? record.site_ids.map(String) : [record.site_id == null ? "all" : String(record.site_id)];
    for (const site of sites) {
      const entry = bySite.get(site) ?? { evidence_ids: [], sample_count: 0, observed: [], baseline: [], series: [], tests: new Set<string>() };
      const siteSeries = record.site_series?.[site] ?? (record.site_id != null && String(record.site_id) === site ? record.series ?? [] : []);
      if (record.evidence_id) entry.evidence_ids.push(record.evidence_id);
      entry.sample_count += siteSeries.length || (record.site_id != null && String(record.site_id) === site ? record.sample_count ?? 0 : 0);
      entry.series.push(...siteSeries);
      if (siteSeries.length) entry.observed.push(siteSeries[siteSeries.length - 1]);
      else if (record.site_id != null && String(record.site_id) === site && record.current_value != null) entry.observed.push(record.current_value);
      if (record.baseline != null) entry.baseline.push(record.baseline);
      for (const test of record.affected_tests ?? (record.test_name ? [record.test_name] : [])) entry.tests.add(test);
      bySite.set(site, entry);
    }
  }
  const sites = [...bySite.entries()].map(([site, entry]) => ({
    site,
    evidence_ids: [...new Set(entry.evidence_ids)],
    sample_count: entry.sample_count,
    observed_values: entry.observed,
    baseline_values: entry.baseline,
    series: entry.series,
    tests: [...entry.tests],
  }));
  return { incident_id: incidentId ?? null, sites, limitation: sites.length < 2 ? "目前 evidence 不足以完成跨 site 比較。" : null };
}

const requireScope = (actualRun: string, allowedRun: string, actualTester: string | null, allowedTester?: string | null) => {
  if (actualRun !== allowedRun) throw new Error("tool run_id is outside the allowed investigation scope");
  if (allowedTester && actualTester && actualTester !== allowedTester) throw new Error("tool tester_id is outside the allowed investigation scope");
};

export function persistentToolExecutor(scope: { run_id: string; tester_id?: string | null }): ToolExecutor {
  return async (name, rawArguments) => {
    if (name === "get_run_summary") {
      const args = runArgs.parse(rawArguments); requireScope(args.run_id, scope.run_id, args.tester_id, scope.tester_id);
      const snapshot = await getRunSnapshot(args.run_id, args.tester_id ?? scope.tester_id);
      if (!snapshot) throw new Error("run not found");
      const output = summarize(snapshot);
      return { output, evidence_ids: [] };
    }
    if (name === "get_incident_evidence") {
      const args = incidentArgs.parse(rawArguments); requireScope(args.run_id, scope.run_id, null, scope.tester_id);
      const result = await getIncident(args.incident_id, args.run_id);
      if (!result || (scope.tester_id && result.tester_id !== scope.tester_id)) throw new Error("incident not found in allowed scope");
      const evidenceIds = result.evidence.flatMap(record => record.evidence_id ? [record.evidence_id] : []);
      return { output: result, evidence_ids: evidenceIds };
    }
    const args = compareArgs.parse(rawArguments); requireScope(args.run_id, scope.run_id, args.tester_id, scope.tester_id);
    const snapshot = await getRunSnapshot(args.run_id, args.tester_id ?? scope.tester_id);
    if (!snapshot) throw new Error("run not found");
    const output = compareEvidence(snapshot.evidence, args.incident_id);
    return { output, evidence_ids: output.sites.flatMap(site => site.evidence_ids) };
  };
}

export function contextToolExecutor(view: EventView): ToolExecutor {
  const runId = view.event.run_id;
  const testerId = view.event.tester_id;
  const evidence = view.evidence.map(record => ({
    event_id: record.event_id, type: "evidence" as const, source_mode: view.event.mode, run_id: record.run_id,
    tester_id: record.tester_id, lot_id: record.lot_id, wafer_id: record.wafer_id, site_id: record.site ?? undefined,
    timestamp: view.event.occurred_at, evidence_id: record.evidence_id, incident_id: view.event.incident_id ?? undefined,
    test_name: record.test_name, unit: record.unit, sample_count: record.sample_count,
    current_value: record.observed ?? undefined, baseline: record.baseline ?? undefined, series: record.series.map(point => point.value),
    data_quality: view.event.data_quality,
  }));
  return async (name, rawArguments) => {
    if (name === "get_run_summary") {
      const args = runArgs.parse(rawArguments); requireScope(args.run_id, runId, args.tester_id, testerId);
      const output = {
        run_id: runId, tester_id: testerId, source_mode: view.event.mode, last_event_at: view.event.occurred_at,
        data_quality: view.event.data_quality, event_counts: { [view.event.kind]: 1 }, incident_count: view.incident ? 1 : 0,
        open_incidents: view.incident ? [view.incident.incident_id] : [], evidence_ids: evidence.flatMap(record => record.evidence_id ? [record.evidence_id] : []),
      };
      return { output, evidence_ids: [] };
    }
    if (name === "get_incident_evidence") {
      const args = incidentArgs.parse(rawArguments); requireScope(args.run_id, runId, null, testerId);
      if (!view.incident || view.incident.incident_id !== args.incident_id) throw new Error("incident not found in allowed context");
      return { output: { incident: view.incident, evidence }, evidence_ids: evidence.flatMap(record => record.evidence_id ? [record.evidence_id] : []) };
    }
    const args = compareArgs.parse(rawArguments); requireScope(args.run_id, runId, args.tester_id, testerId);
    const output = compareEvidence(evidence, args.incident_id);
    return { output, evidence_ids: output.sites.flatMap(site => site.evidence_ids) };
  };
}

export const investigationHelpers = { summarize, compareEvidence };
