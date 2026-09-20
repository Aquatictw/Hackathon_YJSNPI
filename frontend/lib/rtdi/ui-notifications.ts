import type {Snapshot} from './dashboard.ts';

type RecordLocation = {wafer_id?: string; site_id?: number; site_ids?: number[]};
export type ArrivalLocation = {wafer: string | null; sites: number[]};
export type RunNotification = {id: number; kind: 'temperature' | 'incident'; count: number; locations: ArrivalLocation[]};
type Schedule = (callback: () => void) => () => void;
const scheduleDefault: Schedule = callback => {const timer = setTimeout(callback, 2000); return () => clearTimeout(timer);};
const location = (record?: RecordLocation): ArrivalLocation => ({
  wafer: record?.wafer_id?.trim() || null,
  sites: [...new Set(record?.site_id === undefined ? record?.site_ids ?? [] : [record.site_id])].sort((a, b) => a - b),
});
function locations(values: ArrivalLocation[]) {
  return [...new Map(values.map(value => [JSON.stringify(value), value])).values()].slice(0, 3);
}

/** Complete snapshots establish history. SSE payloads/cursors and source clocks
 * cannot distinguish an initial replay from an arrival. Reset on every gap. */
export function createRunNotifications(publish: (items: RunNotification[]) => void, schedule: Schedule = scheduleDefault) {
  let events = new Set<string>(), incidents = new Set<string>(), baseline = false;
  let items: RunNotification[] = [], pendingCount = 0, pendingLocations: ArrivalLocation[] = [];
  let cancel: (() => void) | undefined, serial = 0;
  const emit = () => publish([...items]);
  const add = (kind: RunNotification['kind'], count: number, supplied: ArrivalLocation[]) => {
    const prior = kind === 'temperature' ? items.find(item => item.kind === kind) : undefined;
    const item: RunNotification = {id: prior?.id ?? ++serial, kind, count: (prior?.count ?? 0) + count, locations: locations([...(prior?.locations ?? []), ...supplied])};
    items = [item, ...items.filter(value => value.id !== item.id)]
      .sort((a, b) => Number(b.kind === 'incident') - Number(a.kind === 'incident')).slice(0, 3);
    emit();
  };
  return {
    reset() {
      cancel?.(); cancel = undefined; pendingCount = 0; pendingLocations = [];
      events.clear(); incidents.clear(); baseline = false; items = []; emit();
    },
    dismiss(id: number) {items = items.filter(item => item.id !== id); emit();},
    accept(snapshot: Snapshot, announce: boolean) {
      const freshPredictions = snapshot.events.filter(event => !events.has(event.event_id)
        && event.type === 'prediction' && typeof event.prediction === 'number' && Number.isFinite(event.prediction));
      const freshIncidents = snapshot.incidents.filter(incident => !incidents.has(incident.incident_id));
      for (const event of snapshot.events) events.add(event.event_id);
      for (const incident of snapshot.incidents) incidents.add(incident.incident_id);
      const ready = baseline; baseline = true;
      if (!ready || !announce) return;
      if (freshIncidents.length) add('incident', freshIncidents.length, freshIncidents.map(incident =>
        location(snapshot.evidence.find(event => event.incident_id === incident.incident_id)
          ?? snapshot.events.find(event => event.incident_id === incident.incident_id))));
      if (freshPredictions.length) {
        pendingCount += freshPredictions.length;
        pendingLocations = locations([...pendingLocations, ...freshPredictions.map(location)]);
        if (!cancel) cancel = schedule(() => {
          cancel = undefined; add('temperature', pendingCount, pendingLocations); pendingCount = 0; pendingLocations = [];
        });
      }
    },
  };
}

export function notificationCopy(item: RunNotification, locale: 'en' | 'zh-TW') {
  const zh = locale === 'zh-TW';
  return {
    title: item.kind === 'incident'
      ? zh ? `${item.count} 筆新異常事件` : `${item.count} new incident${item.count === 1 ? '' : 's'}`
      : zh ? `${item.count} 筆新溫度預測` : `${item.count} new temperature prediction${item.count === 1 ? '' : 's'}`,
    detail: (item.count > 1 ? (zh ? '包含 ' : 'Including ') : '') + item.locations.map(value => {
      const wafer = value.wafer === null ? (zh ? '晶圓未知' : 'Wafer unknown') : `${zh ? '晶圓' : 'Wafer'} ${value.wafer}`;
      const sites = value.sites.length ? `${zh ? '站點' : 'Site'} ${value.sites.slice(0, 4).join(', ')}${value.sites.length > 4 ? '…' : ''}` : zh ? '站點未知' : 'Site unknown';
      return `${wafer} · ${sites}`;
    }).join(' / '),
    dismiss: zh ? '關閉通知' : 'Dismiss notification',
  };
}
