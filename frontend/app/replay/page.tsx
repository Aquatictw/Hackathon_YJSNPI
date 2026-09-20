"use client";
import {useState, useSyncExternalStore} from 'react';
import {useLocale} from '@/components/locale-provider';
import {AppHeader} from '@/components/app-header';
import {RunAnalysis} from '@/components/run-analysis';
import {OfflineReplayAnalysis} from '@/components/offline-replay-analysis';
import {StoredRunPicker} from '@/components/stored-run-picker';
import {readReplayView, selectReplayView} from '@/lib/rtdi/source-session';
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
 const {t}=useLocale();
 const [view,setView]=useState(readReplayView);
 const [scope,setScope]=useState<{run:string;tester:string}>();
 const [error,setError]=useState('');
 function select(view:'bundled'|'backend',scope?:{run:string;tester:string}){
  try{selectReplayView(view);}
  catch{setError('Browser storage is unavailable or full. The source could not be changed; your previous dataset is retained.');return;}
  setError('');setView(view);setScope(scope);
 }
 return <>{error&&<p role="alert">{t(error)}</p>}{view==='backend'
  ? <RunAnalysis initialScope={scope} onSummary={()=>select('bundled')}/>
  : <OfflineReplayAnalysis restoreImport={view==='imported'} onSourceChange={setView} sourceChooser={loadBundled=><StoredRunPicker key={view} summarySelected={view==='bundled'} onLoadSummary={loadBundled} onLoad={(run,tester)=>select('backend',{run,tester})}/>}/>}</>;
}
