'use client';
import {useLocale} from "@/components/locale-provider";

import {useEffect, useState} from 'react';
import {ThemeProvider, useTheme} from 'next-themes';
import {Monitor} from 'lucide-react';

export function AppTheme({children}: {children: React.ReactNode}) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="rtdi-theme" disableTransitionOnChange>{children}</ThemeProvider>;
}

export function ThemeSelector() {
 const {t, locale} = useLocale();

  const {theme, setTheme} = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Keep server markup and the first client render identical. next-themes' head
  // script applies the stored/OS color before this control becomes interactive.
  return <label className="theme-selector"><Monitor size={15} aria-hidden="true"/><span>{t("Theme")}</span>
    <select aria-label={t("Color theme")} value={mounted ? theme ?? 'system' : 'system'} disabled={!mounted} onChange={e => setTheme(e.target.value)}>
      <option value="system">{t("System")}</option><option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option>
    </select>
  </label>;
}
