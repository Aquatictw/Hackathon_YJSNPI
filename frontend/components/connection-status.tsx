'use client';
import {useEffect, useState} from 'react';
import {useLocale} from '@/components/locale-provider';
import {backendConnection, isHostRelay, sourceAge, sourceAgeLabel, sourceAgeHeading, storedSourceStatus, type StoredSource} from '@/lib/rtdi/connection-status';
import './connection-status.css';

export function BackendConnectionStatus({status}: {status: string}) {
  const {locale} = useLocale();
  const connection = backendConnection(status, locale);
  return <span className="dc-stream-status connection-status" role="status" aria-live="polite">{connection.label}</span>;
}

export function StoredSourceNotice({source}: {source: StoredSource | null}) {
  const {locale, t} = useLocale();
  const provenance = storedSourceStatus(source, locale);
  const hostRelay = isHostRelay(source);
  return <details className="source-connection-notice">
    <summary><span>{t('Source mode')}: </span><strong>{provenance.label}</strong><span className="source-connection-caveat">{hostRelay ? (locale === 'zh-TW' ? '原始機台事件時間' : 'Original machine event times') : (locale === 'zh-TW' ? 'Gemini 遙測未確認' : 'Gemini telemetry unverified')}</span></summary>
    <p>{provenance.note}</p>
    <p>{hostRelay ? (locale === 'zh-TW' ? '後端 SSE 表示瀏覽器與後端的連線。主機轉送不會另行查詢測試機目前的健康狀態。' : 'Backend SSE describes the browser-to-backend connection. The host relay does not separately poll current tester health.') : (locale === 'zh-TW' ? 'Gemini 機台遙測：尚未確認。後端 SSE 連線僅表示瀏覽器與後端之間的連線。' : 'Gemini machine telemetry: unverified. Backend SSE describes only the browser-to-backend connection.')}</p>
  </details>;
}

export function SourceFreshness({source}: {source: StoredSource}) {
  const {locale} = useLocale();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    // Age changes even when SSE heartbeats carry no new source records.
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const age = sourceAge(source.last_event_at, now);
  return <small className="source-freshness">{sourceAgeHeading(source, locale)}: {sourceAgeLabel(age, locale)}</small>;
}

export function ReplayArchiveNotice() {
  const {locale, t} = useLocale();
  return <section className="replay-archive-notice" aria-label={locale === 'zh-TW' ? '離線封存' : 'Offline archive'}>
    <div><strong>{locale === 'zh-TW' ? '離線封存 · 非目前機台資料' : 'Offline archive · Not the current machine feed'}</strong>
    <p>{locale === 'zh-TW' ? '此檢視顯示已儲存的重播摘要，未提供來源事件時間。切換至後端批次以查看記錄與更新。' : 'This view shows saved replay summaries without source event timestamps. Switch to a backend run to inspect records and updates.'}</p></div>
    <a href="/workspace">{t('Run workspace')} <span aria-hidden="true">→</span></a>
  </section>;
}
