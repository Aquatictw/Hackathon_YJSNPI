/** Browser/backend transport and source provenance are independent signals.
 * Neither the SSE ready event nor a recent timestamp verifies Gemini telemetry. */
import {isRecordedCapture} from './run-discovery.ts';
export type StoredSource = {mode: 'live' | 'replay' | 'simulation'; edge_id?: string; last_event_at: string};
export const isHostRelay = (source: StoredSource | null) => source?.mode === 'live' && source.edge_id === 'grp6-hc-relay';
const recordedCapture = (source: StoredSource) => isRecordedCapture({mode: source.mode, edge_id: source.edge_id ?? ''});
export type SourceAge = {state: 'unknown' | 'future' | 'dated'; timestamp: string | null; ageMs: number | null};

export function sourceAge(timestamp: string, now: number): SourceAge {
  // A timezone-free date must not silently acquire the browser's timezone.
  const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(time) || !Number.isFinite(now)) return {state: 'unknown', timestamp: null, ageMs: null};
  return {state: time > now ? 'future' : 'dated', timestamp: new Date(time).toISOString(), ageMs: time > now ? null : now - time};
}

export function backendConnection(status: string, locale: string) {
  const zh = locale === 'zh-TW';
  const labels: Record<string, [string, string]> = {
    'Not connected': ['Backend SSE · Not connected', '後端 SSE · 尚未連線'],
    'Connecting': ['Backend · Loading snapshot', '後端 · 正在載入快照'],
    'Snapshot loaded': ['Backend · Snapshot loaded', '後端 · 已載入快照'],
    'Event stream connected': ['Backend SSE · Connected', '後端 SSE · 已連線'],
    'Reconnecting · Showing last snapshot': ['Backend SSE · Reconnecting; stored snapshot shown', '後端 SSE · 重新連線中；顯示已儲存快照'],
    'Event stream interrupted · Waiting to reconnect': ['Backend SSE · Interrupted; waiting to reconnect', '後端 SSE · 已中斷；等待重新連線'],
    'Snapshot refresh failed': ['Backend · Snapshot refresh failed', '後端 · 快照更新失敗'],
    'Connection failed': ['Backend · Connection failed', '後端 · 連線失敗'],
    'Disconnected · Showing last snapshot': ['Backend SSE · Disconnected; stored snapshot shown', '後端 SSE · 已斷線；顯示已儲存快照'],
  };
  return {connected: status === 'Event stream connected', label: labels[status]?.[zh ? 1 : 0] ?? (zh ? '後端 · 狀態不明' : 'Backend · Status unknown')};
}

export function storedSourceStatus(source: StoredSource | null, locale: string) {
  const zh = locale === 'zh-TW';
  if (!source) return {label: zh ? '尚未載入批次' : 'No run loaded', note: zh ? '載入後端批次以查看來源與時間。' : 'Load a backend run to inspect its source and timestamp.'};
  if (isHostRelay(source)) return {label: zh ? 'Gemini · 主機日誌轉送' : 'Gemini · Host log relay', note: zh ? 'Gemini EdgeLog 經主機持久佇列與 HTTPS 傳入。保留原始事件時間；批次完成後，記錄仍可查看。請以來源時間判斷資料新舊。' : 'Gemini EdgeLog records arrive through the durable host queue and HTTPS. Original event times are preserved; completed runs remain available. Check source time for recency.'};
  if (recordedCapture(source)) return {label: zh ? 'RECORDED · Gemini 擷取 · REPLAY' : 'RECORDED · Gemini capture · REPLAY', note: zh ? '已錄製的 Gemini 擷取資料，保留原始機台事件時間；不代表目前資料串流。' : 'Recorded Gemini capture with original machine event timestamps; this is not a current feed.'};
  if (source.mode === 'replay' && source.edge_id === 'grp6-replay-exporter') return {label: zh ? 'REPLAY · 離線重播記錄' : 'REPLAY · Offline records', note: zh ? '時間戳記代表重播匯入順序，不是目前機台量測時間。' : 'Timestamps represent replay import ordering, not current machine measurement time.'};
  const modes = {
    live: {label: zh ? 'LIVE · 來源回報 · 已儲存記錄' : 'LIVE · Source-reported · Stored records', note: zh ? '來源標記為 live；已儲存記錄不代表目前機台連線。' : 'The source labels these records live; stored records do not establish a current machine connection.'},
    replay: {label: zh ? 'REPLAY · 離線記錄' : 'REPLAY · Offline records', note: zh ? '重播記錄；時間戳記的來源未確認，不代表目前機台資料。' : 'Replay records; timestamp provenance is unverified and does not establish a current machine feed.'},
    simulation: {label: zh ? 'SIMULATION · 模擬記錄' : 'SIMULATION · Synthetic records', note: zh ? '模擬時間戳記不能用於判斷機台資料是否即時。' : 'Simulation timestamps do not establish machine data freshness.'},
  };
  return modes[source.mode];
}

export function sourceAgeHeading(source: StoredSource, locale: string) {
  const zh = locale === 'zh-TW';
  if (recordedCapture(source)) return zh ? '原始機台事件距今' : 'Original machine event age';
  if (source.mode === 'replay' && source.edge_id === 'grp6-replay-exporter') return zh ? '重播排序時間距今' : 'Replay ordering age';
  if (source.mode === 'simulation') return zh ? '模擬時間距今' : 'Simulation timestamp age';
  return zh ? '來源時間距今' : 'Source timestamp age';
}

export function sourceAgeLabel(age: SourceAge, locale: string) {
  const zh = locale === 'zh-TW';
  if (age.state === 'unknown' || age.ageMs === null) return age.state === 'future'
    ? (zh ? '時間戳記晚於瀏覽器時間 · 無法確認新鮮度' : 'Timestamp is ahead of browser clock · Freshness unverified')
    : (zh ? '來源時間不可用 · 無法確認新鮮度' : 'Source time unavailable · Freshness unknown');
  const minutes = Math.floor(age.ageMs / 60_000);
  if (minutes < 1) return zh ? '不到 1 分鐘前' : 'Less than 1 minute ago';
  const [amount, unit] = minutes >= 1440 ? [Math.floor(minutes / 1440), 'day'] as const
    : minutes >= 60 ? [Math.floor(minutes / 60), 'hour'] as const : [minutes, 'minute'] as const;
  return new Intl.RelativeTimeFormat(locale, {numeric: 'always'}).format(-amount, unit);
}
