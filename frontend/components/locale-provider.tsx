'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { isLocale, localeStorageKey, translate, type Locale } from '@/lib/rtdi/locale';
type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (text: string | number | null | undefined, ...values: unknown[]) => string };
const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', setLocale: () => {}, t: (text, ...values) => translate('en', text, ...values) });
function persistCookie(locale: Locale) {
  try { document.cookie = `${localeStorageKey}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* Browser storage may be denied. */ }
}
export function LocaleProvider({ children, initialLocale = 'en' }: { children: React.ReactNode; initialLocale?: Locale }) {
  // Match the server during hydration; reconcile legacy browser-only preferences before paint.
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  useLayoutEffect(() => {
    try { const saved = localStorage.getItem(localeStorageKey) ?? localStorage.getItem('rtdi.response-language'); if (isLocale(saved)) updateLocale(saved); } catch { /* Storage denial still permits in-memory switching. */ }
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === localeStorageKey && isLocale(event.newValue)) updateLocale(event.newValue); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === 'zh-TW' ? 'RTDI | 測試分析' : 'RTDI | Test Analysis';
    persistCookie(locale);
    document.documentElement.removeAttribute('data-locale-pending');
  }, [locale]);
  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale: next => {
    if (!isLocale(next)) return;
    updateLocale(next);
    persistCookie(next);
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
