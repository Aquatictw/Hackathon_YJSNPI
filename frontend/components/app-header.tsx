'use client';

import {Activity, FlaskConical, Layers3} from 'lucide-react';
import {ThemeSelector} from '@/components/theme-controls';
import './app-header.css';

const pages = [
  {id: 'replay', href: '/', label: 'Replay analysis', icon: Activity},
  {id: 'workspace', href: '/workspace', label: 'Run workspace', icon: Layers3},
  {id: 'sandbox', href: '/sandbox', label: 'Sandbox', icon: FlaskConical},
] as const;

export function AppHeader({active}: {active: typeof pages[number]['id']}) {
  return <>
    <a className="app-skip" href="#main-content">Skip to main content</a>
    <header className="app-header">
      <a className="app-brand" href="/" aria-label="RTDI test analysis home">
        <Activity size={23} aria-hidden="true"/><strong>RTDI</strong><span>TEST ANALYSIS</span>
      </a>
      <nav className="app-nav" aria-label="Main navigation">
        {pages.map(({id, href, label, icon: Icon}) =>
          <a key={id} href={href} aria-current={active === id ? 'page' : undefined}>
            <Icon size={16} aria-hidden="true"/>{label}
          </a>)}
      </nav>
      <div className="app-header-tools"><ThemeSelector/><span className="app-team">GRP6</span></div>
    </header>
  </>;
}
