'use client';

import {useEffect, useState} from 'react';
import {ThemeProvider, useTheme} from 'next-themes';
import {Monitor} from 'lucide-react';

export function AppTheme({children}: {children: React.ReactNode}) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="rtdi-theme" disableTransitionOnChange>{children}</ThemeProvider>;
}

export function ThemeSelector() {
  const {theme, setTheme} = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Keep server markup and the first client render identical. next-themes' head
  // script applies the stored/OS color before this control becomes interactive.
  return <label className="theme-selector"><Monitor size={15} aria-hidden="true"/><span>外觀</span>
    <select aria-label="色彩主題" value={mounted ? theme ?? 'system' : 'system'} disabled={!mounted} onChange={e => setTheme(e.target.value)}>
      <option value="system">跟隨系統</option><option value="light">亮色</option><option value="dark">深色</option>
    </select>
  </label>;
}
