"use client";
import {useState, useSyncExternalStore} from 'react';
import {useLocale} from '@/components/locale-provider';
import {AppHeader} from '@/components/app-header';
import {RunAnalysis} from '@/components/run-analysis';
import {OfflineReplayAnalysis} from '@/components/offline-replay-analysis';
import {StoredRunPicker} from '@/components/stored-run-picker';
import './replay.css';

const subscribeHydration=()=>()=>{};
const clientSnapshot=()=>true;
const serverSnapshot=()=>false;
export default function ReplayPage(){
 const {t}=useLocale();
 // Defer browser storage and backend lifecycle until after hydration.
 const hydrated=useSyncExternalStore(subscribeHydration,clientSnapshot,serverSnapshot);
 return hydrated?<ReplayClient/>:<div className="dc-app"><AppHeader active="replay"/><main id="main-content" aria-busy="true"><p role="status">{t('Restoring selected source…')}</p></main></div>;
}
function ReplayClient(){
 const [scope,setScope]=useState<{run:string;tester:string}|null>(null);
 const [archiveVersion,setArchiveVersion]=useState(0);
 return scope ? <RunAnalysis initialScope={scope} onSummary={()=>setScope(null)}/>
 : <OfflineReplayAnalysis key={archiveVersion} sourceChooser={<StoredRunPicker summarySelected onLoadSummary={()=>setArchiveVersion(value=>value+1)} onLoad={(run,tester)=>setScope({run,tester})}/>}/>;
}
