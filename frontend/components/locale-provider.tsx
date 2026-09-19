'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isLocale, localeStorageKey, translate, type Locale } from '@/lib/rtdi/locale';
type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (text: string | number | null | undefined, ...values: unknown[]) => string };
const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', setLocale: () => {}, t: (text, ...values) => translate('en', text, ...values) });
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>('en');
  useEffect(() => {
    try { const saved = localStorage.getItem(localeStorageKey) ?? localStorage.getItem('rtdi.response-language'); if (isLocale(saved)) updateLocale(saved); } catch { /* Storage denial still permits in-memory switching. */ }
    const sync = (event: StorageEvent) => { if (event.key === localeStorageKey && isLocale(event.newValue)) updateLocale(event.newValue); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; document.title = locale === 'zh-TW' ? 'RTDI | 測試分析' : 'RTDI | Test Analysis'; }, [locale]);
  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale: next => {
    if (!isLocale(next)) return;
    updateLocale(next);
    try { localStorage.setItem(localeStorageKey, next); localStorage.setItem('rtdi.response-language', next); } catch { /* Keep current page usable. */ }
  }, t: (text, ...values) => translate(locale, text, ...values) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
export function LanguageSelector() {
  const { locale, setLocale, t } = useLocale();
  return <label className="theme-selector language-selector"><span aria-hidden="true">文/A</span><select aria-label={t('Website language')} value={locale} onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value); }}>
    <option value="en" lang="en">English</option><option value="zh-TW" lang="zh-TW">繁體中文</option>
  </select></label>;
}
