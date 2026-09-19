import type {Replay} from './replay.ts';

/** Display precision only; original evidence remains available unchanged. */
export function displayNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '未提供';
  if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e7)) return value.toExponential(3);
  return new Intl.NumberFormat('en-US', {maximumFractionDigits: 4}).format(value);
}
export function investigationAvailability(config: {openai_configured: boolean; backend_connected: boolean} | null, failed: boolean) {
  if (failed) return {enabled: false, title: '設定讀取失敗', message: '請重新檢查服務設定。仍可查看已載入的證據，或前往重播分析。'};
  if (!config) return {enabled: false, title: '正在確認設定', message: '正在確認調查服務是否可用。'};
  if (!config.backend_connected) return {enabled: false, title: '資料服務未連線', message: '請服務管理者確認資料庫連線；目前可先查看離線重播。'};
  if (!config.openai_configured) return {enabled: false, title: 'AI 尚未啟用', message: '請服務管理者設定 OpenAI 服務後重新檢查。現有證據可正常瀏覽；示範沙盒提供固定規則解讀。'};
  return {enabled: true, title: '可提出調查', message: '服務已設定；送出後才會呼叫 OpenAI。回答及引用由後端儲存，成功與否以實際回應為準。'};
}
/** Evaluation is supplied metadata, never a wafer-number rule. */
export function waferEvaluation(wafer: Replay['wafers'][number]) {
  if (wafer.expected === 'normal') return null;
  return wafer.expected_first_device === null
    ? '來源評估：未偵測到預期類型；保留漏報限制。'
    : `來源評估：完成 ${wafer.expected_first_device} 顆時偵測到預期類型。`;
}

export function replaySelection(wafers: Replay['wafers'], selected: string, filter: string) {
  const visible = wafers.filter(w => filter === 'all' || (w.alerts.length ? 'alert' : 'quiet') === filter);
  return visible.find(w => w.wafer === selected)?.wafer ?? visible[0]?.wafer ?? '';
}
