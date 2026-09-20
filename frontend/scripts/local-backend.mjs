// Local development only: uses D's migration and replay adapter, never a remote DB.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {replayJsonlToEdgeBatches} from '../lib/rtdi/replay-adapter.ts';
import {predictionSeedBatches,validateSeedAck} from './seed-support.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const isMain=process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
const mode=isMain ? process.argv[2] : undefined;
export function isDeletedTrainingScope(response, body, batch) {
 return response.status===409 && body?.error==='run_scope_deleted'
  && Array.isArray(body.conflicting_ids) && body.conflicting_ids.length===1
  && body.conflicting_ids[0]===JSON.stringify(['grp6-replay-demo','grp6-replay'])
  && batch.events.length>0 && batch.events.every(event=>event.run_id==='grp6-replay-demo' && event.tester_id==='grp6-replay');
}
if(mode==='migrate'){
 const folder=await mkdtemp(join(tmpdir(),'grp6-local-d1-'));const config=join(folder,'wrangler.json');
 await writeFile(config,JSON.stringify({name:'grp6-local-check',compatibility_date:'2026-09-19',d1_databases:[{binding:'DB',database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000',migrations_dir:join(root,'drizzle')}]}));
 const r=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--config',config,'--persist-to',join(root,'.wrangler/state')],{cwd:root,stdio:'inherit'});if(r.error)throw r.error;process.exitCode=r.status??1;
}else if(mode==='seed'){
 const vars=await readFile(join(root,'.dev.vars'),'utf8');
 const token=process.env.INGEST_TOKEN||vars.match(/^INGEST_TOKEN\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
 if(!token)throw Error('Set INGEST_TOKEN in .dev.vars and restart the dev server first.');
 const lines=(await readFile(join(root,'../results/replay/replay.jsonl'),'utf8')).split(/\r?\n/);
 const batches=await replayJsonlToEdgeBatches(lines,{edgeId:'grp6-replay-exporter',runId:'grp6-replay-demo',testerId:'grp6-replay',startedAt:'2026-09-19T00:00:00Z'});
 batches.push(...await predictionSeedBatches(await readFile(join(root,'../results/replay/predictions.jsonl'),'utf8')));
 let deleted=false;
 for(const batch of batches){const r=await fetch('http://localhost:5173/api/v1/events/batch',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(batch),signal:AbortSignal.timeout(30000)});const body=await r.json();if(isDeletedTrainingScope(r,body,batch)){deleted=true;console.log('Replay seed skipped: grp6-replay-demo / grp6-replay was explicitly deleted.');break;}if(!r.ok)throw Error(`Local ingest failed (${r.status}): ${body.error??'unknown error'}`);validateSeedAck(batch,body);console.log(`Replay: ${body.accepted.length} accepted, ${body.duplicates.length} duplicates.`);}
 if(!deleted)console.log('Open localhost:5173 and load run grp6-replay-demo / tester grp6-replay.');
}else if(isMain)throw Error('Usage: node scripts/local-backend.mjs migrate|seed');
