'use client';
import {TriangleAlert, Thermometer, X} from 'lucide-react';
import {useLocale} from '@/components/locale-provider';
import {notificationCopy, notificationHref, type RunNotification} from '@/lib/rtdi/ui-notifications';
import './run-notifications.css';

export function RunNotifications({items, scope, onOpen, onDismiss}: {items: RunNotification[]; scope: {run: string; tester: string} | null; onOpen?: (item: RunNotification) => void; onDismiss: (id: number) => void}) {
  const {locale} = useLocale();
  return <aside className="run-notifications" aria-label={locale === 'zh-TW' ? '新資料通知' : 'Incoming data notifications'}>
    <div role="status" aria-live="polite" aria-relevant="additions text">{items.map(item => {
      const copy = notificationCopy(item, locale);
      const Icon = item.kind === 'incident' ? TriangleAlert : Thermometer;
      return <article key={item.id} className={'run-notification run-notification--' + item.kind}>
        <span className="run-notification-icon"><Icon size={20} aria-hidden="true"/></span>
        <a className="run-notification-copy" href={scope ? notificationHref(item, scope) : '/workspace'} onClick={event => {
          if (onOpen && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {event.preventDefault(); onOpen(item);}
        }}><strong>{copy.title}</strong><p>{copy.detail}</p></a>
        <button type="button" aria-label={copy.dismiss + ': ' + copy.title} onClick={() => onDismiss(item.id)}><X size={16} aria-hidden="true"/></button>
      </article>;
    })}</div>
  </aside>;
}
