"use client";

import { useEffect, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { z } from 'zod';
import { useLocale } from '@/components/locale-provider';
import { SemiconductorChat, type ResponseLanguage } from '@/components/semiconductor-chat';

// Deliberately accepts no archive or backend scope: only general Q&A is available.
export function SummaryAssistant() {
    const { t, locale: language, setLocale: changeLanguage } = useLocale();
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        setConfigured(null); setFailed(false);
        fetch('/api/config', { signal: controller.signal, cache: 'no-store' })
            .then(response => { if (!response.ok) throw Error('Configuration unavailable'); return response.json(); })
            .then(value => {
                const config = z.object({ openai_configured: z.boolean() }).parse(value);
                if (active) setConfigured(config.openai_configured);
            })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; controller.abort(); };
    }, [attempt]);

    return <aside className="dc-ai" aria-labelledby="investigation-heading">
        <div className="dc-ai-heading"><NotebookPen size={18}/><div><h2 id="investigation-heading">{t('Semiconductor assistant')}</h2><small>{t('Semiconductor concepts · Local references')}</small></div></div>
        <div className="dc-assistant-controls">
            <div className="dc-assistant-modes" role="group" aria-label={t('Assistant topic')}>
                <button type="button" disabled aria-pressed={false} aria-describedby="summary-analysis-note">{t('Selected analysis')}</button>
                <button type="button" aria-pressed={true}>{t('Semiconductor Q&A')}</button>
            </div>
            <p id="summary-analysis-note">{t('Imported summary evidence is not sent to the model. Load a backend run to investigate verified backend records.')}</p>
            <label htmlFor="response-language">{t('Response language')}<select id="response-language" value={language} onChange={event => changeLanguage(event.target.value as ResponseLanguage)}><option value="en">{t('English')}</option><option value="zh-TW">繁體中文</option></select></label>
            <small>{t('Applies to the next submitted question.')}</small>
        </div>
        {(!configured || failed) && <div className="dc-service-state" role="status"><strong>{failed ? t('Service check failed') : configured === null ? t('Checking service') : t('Model service unavailable')}</strong><p>{t('General questions need the model service, but do not need a loaded run.')}</p><button type="button" className="dc-secondary" onClick={() => setAttempt(value => value + 1)}>{t('Retry service check')}</button></div>}
        <SemiconductorChat enabled={configured === true && !failed} language={language}/>
    </aside>;
}
