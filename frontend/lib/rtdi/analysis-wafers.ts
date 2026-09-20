import type {Snapshot} from './dashboard.ts';
import {predictionRows} from './ui-predictions.ts';
import {canonicalJson} from './wire.ts';

export type AnalysisWafer = {
  key: string;
  waferId: string | null;
  lotId: string | null;
  yieldRatio?: number;
  devices?: number;
  lastEventAt?: string;
  alerts: number;
  predictions: number;
  matchedActuals: number;
};

type Record = Snapshot['events'][number];
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const identity = (lot: string | null, wafer: string | null) => JSON.stringify([lot, wafer]);
const compareEvents = (a: Record, b: Record) =>
  Date.parse(a.timestamp) - Date.parse(b.timestamp)
  || (a.sequence ?? -1) - (b.sequence ?? -1)
  || compareText(a.event_id, b.event_id);

function isWaferSummary(event: Record) {
  // The exporter also projects lifecycle/device/request records as run_summary.
  // Its message is the only retained discriminator for those source records.
  return event.type === 'run_summary' && event.site_id === undefined
    && !event.site_ids?.length
    && (event.yield !== undefined || event.completed_devices !== undefined)
    && (!event.message?.startsWith('Edge exporter event: ')
      || event.message === 'Edge exporter event: run_summary');
}

/**
 * Aggregate a normalized, single-run/tester Snapshot. Keys encode [lot, wafer];
 * absent scope remains null and is never filled from run metadata. Evidence
 * events are alert records; incidents are not counted again. Prediction counts
 * include unavailable requests, and actuals use the existing ambiguity checks
 * within the exact lot/wafer group (including supplied inline actuals).
 */
export function analysisWafers(snapshot: Snapshot): AnalysisWafer[] {
  const unique = new Map<string, Record>();
  for (const event of [...snapshot.events, ...snapshot.evidence]) {
    if (event.run_id !== snapshot.run.run_id || event.tester_id !== snapshot.run.tester_id) {
      throw Error('Wafer analysis requires a single run/tester scope.');
    }
    const previous = unique.get(event.event_id);
    if (previous && canonicalJson(previous) !== canonicalJson(event)) {
      throw Error('Conflicting content for the same event ID.');
    }
    unique.set(event.event_id, event);
  }

  const groups = new Map<string, {wafer: AnalysisWafer; events: Record[]}>();
  const groupFor = (lotId: string | null, waferId: string | null) => {
    const key = identity(lotId, waferId);
    let group = groups.get(key);
    if (!group) {
      group = {wafer: {key, lotId, waferId, alerts: 0, predictions: 0, matchedActuals: 0}, events: []};
      groups.set(key, group);
    }
    return group;
  };
  for (const event of unique.values()) {
    groupFor(event.lot_id ?? null, event.wafer_id ?? null).events.push(event);
  }
  // Prefer source records exclusively: run metadata retains lot and wafer
  // independently, so its pair may never have occurred in an actual event.
  // With no records, expose only a metadata placeholder; its identity is not
  // source-verified and it supplies neither metrics nor a wafer event time.
  if (unique.size === 0 && (snapshot.run.wafer_id !== null || snapshot.run.lot_id !== null)) {
    groupFor(snapshot.run.lot_id, snapshot.run.wafer_id);
  }

  for (const {wafer, events} of groups.values()) {
    let latest: Record | undefined;
    let summary: Record | undefined;
    for (const event of events) {
      if (!latest || compareEvents(event, latest) > 0) latest = event;
      if (event.type === 'evidence') wafer.alerts++;
      if (isWaferSummary(event) && (!summary || compareEvents(event, summary) > 0)) summary = event;
    }
    if (latest) wafer.lastEventAt = latest.timestamp;
    // Both metrics come from the same latest applicable summary: no averaging, inferred
    // device counts, or fallback to older values when the latest omits a field.
    if (summary?.yield !== undefined) wafer.yieldRatio = summary.yield;
    if (summary?.completed_devices !== undefined) wafer.devices = summary.completed_devices;
    const predictions = predictionRows(events);
    wafer.predictions = predictions.length;
    wafer.matchedActuals = predictions.filter(event => event.actual !== undefined).length;
  }
  return [...groups.values()].map(group => group.wafer).sort((a, b) => compareText(a.key, b.key));
}
