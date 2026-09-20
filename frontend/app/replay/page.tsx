"use client";
import {useSyncExternalStore} from 'react';
import {useLocale} from '@/components/locale-provider';
import {AppHeader} from '@/components/app-header';
import {RunAnalysis} from '@/components/run-analysis';
import './replay.css';

const subscribeHydration=()=>()=>{};
const clientSnapshot=()=>true;
const serverSnapshot=()=>false;
export default function ReplayPage(){
 const {t}=useLocale();
 // Defer browser storage and backend lifecycle until after hydration.
 const hydrated=useSyncExternalStore(subscribeHydration,clientSnapshot,serverSnapshot);
 return hydrated?<RunAnalysis/>:<div className="dc-app"><AppHeader active="replay"/><main id="main-content" aria-busy="true"><p role="status">{t('Restoring selected source…')}</p></main></div>;
}
