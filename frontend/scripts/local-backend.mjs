// Local development only: uses D's migration and replay adapter, never a remote DB.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {replayJsonlToEdgeBatches} from '../lib/rtdi/replay-adapter.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2];
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
 for(const batch of batches){const r=await fetch('http://localhost:5173/api/v1/events/batch',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(batch)});const body=await r.json();if(!r.ok)throw Error(`Local ingest failed (${r.status}): ${body.error??'unknown error'}`);console.log(`Replay: ${body.accepted.length} accepted, ${body.duplicates.length} duplicates.`);}
 console.log('Open localhost:5173 and load run grp6-replay-demo / tester grp6-replay.');
}else throw Error('Usage: node scripts/local-backend.mjs migrate|seed');
