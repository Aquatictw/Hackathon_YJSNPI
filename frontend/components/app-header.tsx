'use client';
import {useLocale,LanguageSelector} from "@/components/locale-provider";

import {Activity, FlaskConical, Layers3} from 'lucide-react';
import {ThemeSelector} from '@/components/theme-controls';
import {GuidedTour} from '@/components/guided-tour';
import './app-header.css';

const pages = [
  {id: 'replay', href: '/replay', label: 'Replay analysis', icon: Activity},
  {id: 'workspace', href: '/workspace', label: 'Run workspace', icon: Layers3},
  {id: 'sandbox', href: '/sandbox', label: 'Sandbox', icon: FlaskConical},
] as const;

export function AppHeader({active}: {active: typeof pages[number]['id']}) {
 const {t} = useLocale();

  return <>
    <a className="app-skip" href="#main-content">{t("Skip to main content")}</a>
    <header className="app-header">
      <a className="app-brand" href="/replay" aria-label={`RTDI — ${t("Replay analysis")}`}>
        <Activity size={23} aria-hidden="true"/><strong>RTDI</strong>
      </a>
      <nav className="app-nav" aria-label={t("Main navigation")}>
        {pages.map(({id, href, label, icon: Icon}) =>
          <a key={id} href={href} className={id === 'replay' ? 'app-nav-primary' : undefined} aria-current={active === id ? 'page' : undefined}>
            <Icon size={16} aria-hidden="true"/>{t(label)}
          </a>)}
      </nav>
      <div className="app-header-tools"><GuidedTour/><ThemeSelector/><LanguageSelector/><span className="app-team">GRP6</span></div>
    </header>
  </>;
}
