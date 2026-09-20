'use client';
import {TriangleAlert, Thermometer, X} from 'lucide-react';
import {useLocale} from '@/components/locale-provider';
import {notificationCopy, type RunNotification} from '@/lib/rtdi/ui-notifications';
import './run-notifications.css';

export function RunNotifications({items, onDismiss}: {items: RunNotification[]; onDismiss: (id: number) => void}) {
  const {locale} = useLocale();
  return <aside className="run-notifications" aria-label={locale === 'zh-TW' ? '新資料通知' : 'Incoming data notifications'}>
    <div role="status" aria-live="polite" aria-relevant="additions text">{items.map(item => {
      const copy = notificationCopy(item, locale);
      const Icon = item.kind === 'incident' ? TriangleAlert : Thermometer;
      return <article key={item.id} className={'run-notification run-notification--' + item.kind}>
        <span className="run-notification-icon"><Icon size={20} aria-hidden="true"/></span>
        <div className="run-notification-copy"><strong>{copy.title}</strong><p>{copy.detail}</p></div>
        <button type="button" aria-label={copy.dismiss + ': ' + copy.title} onClick={() => onDismiss(item.id)}><X size={16} aria-hidden="true"/></button>
      </article>;
    })}</div>
  </aside>;
}
