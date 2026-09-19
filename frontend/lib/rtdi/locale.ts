import { zhTW } from './locale-zh-TW.ts';
export type Locale = 'en' | 'zh-TW';
export const localeStorageKey = 'rtdi.locale';
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'zh-TW';
const legacyErrors: Record<string,string> = {
 "measurement 需要 value 與 test_name。": "measurement requires value and test_name.",
 "evidence 需要 evidence_id。": "evidence requires evidence_id.",
 "prediction 需要 request_id、stage、device_id。": "prediction requires request_id, stage and device_id.",
 "prediction_actual 需要 run_id、request_id、actual 以避免跨 run 混用。": "prediction_actual requires run_id, request_id and actual to avoid mixing runs.",
 "prediction_actual 找不到唯一對應的 request/run/tester，請先接收預測紀錄。": "prediction_actual has no unique request/run/tester match. Receive the prediction record first.",
 "prediction_actual 的實測內容衝突。": "Conflicting prediction_actual measurements.",
 "相同 batch_id 的內容已改變，請勿覆寫既有批次。": "The same batch_id has changed content. Do not overwrite the existing batch.",
 "相同來源 event_id 的內容衝突。": "Conflicting content for the same source event_id.",
 "相同 event_id 帶有不同內容，請使用新的事件 ID。": "The same event_id has different content. Use a new event ID.",
 "相同 evidence_id 的內容衝突。": "Conflicting content for the same evidence_id.",
 "相同 prediction_id 的內容衝突。": "Conflicting content for the same prediction_id.",
};
// Only known application-generated status templates; never infer translations of source text.
const statusPatterns: [RegExp,string][] = [
 [/^Site (.+)$/, "Site {0}"],
 [/^Request failed \((\d+)\)$/, "Request failed ({0})"],
 [/^Ignored (\d+) duplicate events; no duplicate incidents created\.$/, "Ignored {0} duplicate events; no duplicate incidents created."],
 [/^Batch received; (\d+) unique events in this workspace\.$/, "Batch received; {0} unique events in this workspace."],
 [/^Snapshot request failed \(HTTP (\d+)\)\. Retry or import a replay summary\. Any previous dataset is retained\.$/, "Snapshot request failed (HTTP {0}). Retry or import a replay summary. Any previous dataset is retained."],
];
/** Only application-owned presentation strings belong here. Never pass source records or answers. */
export function translate(locale: Locale, text: string | number | null | undefined, ...values: unknown[]): string {
  let source = text == null ? '' : String(text);
  if (legacyErrors[source]) return locale === "en" ? legacyErrors[source] : source.replace("紀錄", "記錄");
  if (/Failed to fetch|fetch failed|NetworkError|Load failed/.test(source)) source = "Network request failed. Check the connection and retry.";
  if (source.startsWith('[\n') && source.includes('"code"')) source = "Invalid response from the service.";
  if (locale === "zh-TW" && !zhTW[source]) {
    for (const [pattern,key] of statusPatterns) {const match=source.match(pattern);if(match)return translate(locale,key,...match.slice(1));}
  }
  const translated = locale === 'zh-TW' ? zhTW[source] ?? source : source;
  return translated.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);
}
