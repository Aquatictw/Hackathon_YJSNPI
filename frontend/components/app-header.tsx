'use client';
import {useLocale,LanguageSelector} from "@/components/locale-provider";

import {Activity, FlaskConical, Layers3} from 'lucide-react';
import {ThemeSelector} from '@/components/theme-controls';
import {GuidedTour} from '@/components/guided-tour';
import './app-header.css';

const pages = [
  {id: 'workspace', href: '/workspace', label: 'Run workspace', icon: Layers3},
  {id: 'replay', href: '/replay', label: 'Replay analysis', icon: Activity},
  {id: 'sandbox', href: '/sandbox', label: 'Sandbox', icon: FlaskConical},
] as const;

export function AppHeader({active}: {active: typeof pages[number]['id']}) {
 const {t} = useLocale();

  return <>
    <a className="app-skip" href="#main-content">{t("Skip to main content")}</a>
    <header className="app-header">
      <a className="app-brand" href="/workspace" aria-label={t("Run workspace")}>
        <Activity size={23} aria-hidden="true"/><strong>RTDI</strong><span>{t("TEST ANALYSIS")}</span>
      </a>
      <nav className="app-nav" aria-label={t("Main navigation")}>
        {pages.map(({id, href, label, icon: Icon}) =>
          <a key={id} href={href} className={id === 'workspace' ? 'app-nav-primary' : undefined} aria-current={active === id ? 'page' : undefined}>
            <Icon size={16} aria-hidden="true"/>{t(label)}
          </a>)}
      </nav>
      <div className="app-header-tools"><GuidedTour/><ThemeSelector/><LanguageSelector/><span className="app-team">GRP6</span></div>
    </header>
  </>;
}
