import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceSessionKey,readSourceSession,writeSourceSession,selectBackendSource,updateReplaySelection} from '../lib/rtdi/source-session.ts';
const data=JSON.parse(readFileSync(new URL('../public/replay/summary.json',import.meta.url),'utf8'));
const selection={waferId:'3',alertIndex:0,filter:'alert',tab:'analysis',detailOpen:true};
const imported={version:1,mode:'summary',replay:{data,filename:'my-summary.json',selection}};
function storage(){const values=new Map();globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};return values;}
test('import and selection survive page reads; backend selection retains imported evidence',()=>{
 storage();writeSourceSession(imported);
 assert.equal(readSourceSession().replay.filename,'my-summary.json');
 updateReplaySelection({...selection,waferId:'14',tab:'validation'});
 selectBackendSource();
 assert.equal(readSourceSession().mode,'backend');
 assert.equal(readSourceSession().replay.selection.waferId,'14');
 assert.equal(readSourceSession().replay.selection.tab,'validation');
 assert.equal(readSourceSession().replay.data.wafers.length,data.wafers.length);
});
test('invalid replacement cannot destroy stored source and malformed cache is rejected',()=>{
 const values=storage();writeSourceSession(imported);
 assert.throws(()=>writeSourceSession({...imported,replay:{...imported.replay,data:{mode:'live'}}}));
 assert.equal(readSourceSession().replay.filename,'my-summary.json');
 values.set(sourceSessionKey,'{broken');assert.equal(readSourceSession(),null);
 values.set(sourceSessionKey,JSON.stringify({version:1,mode:'summary'}));assert.equal(readSourceSession(),null);
});
test('storage denial/quota is explicit so UI cannot silently accept a transient import',()=>{
 storage();sessionStorage.setItem=()=>{throw new Error('QuotaExceededError');};
 assert.throws(()=>writeSourceSession(imported),/Quota/);
 sessionStorage.getItem=()=>{throw new Error('SecurityError');};
 assert.equal(readSourceSession(),null);
});
