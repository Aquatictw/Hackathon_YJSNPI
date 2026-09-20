import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceSessionKey,readSourceSession,writeSourceSession,selectBackendSource,updateReplaySelection,readReplayView,selectReplayView} from '../lib/rtdi/source-session.ts';
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
test('first Replay visit defaults to bundled independently of the saved Workspace source',()=>{
 const values=storage();assert.equal(readReplayView(),'bundled');
 writeSourceSession(imported);assert.equal(readReplayView(),'bundled');
 selectBackendSource();assert.equal(readReplayView(),'bundled');
 values.set(sourceSessionKey,'{broken');assert.equal(readReplayView(),'bundled');
 sessionStorage.getItem=()=>{throw Error('denied');};assert.equal(readReplayView(),'bundled');
});
test('explicit Replay switches survive navigation without changing Workspace mode or imported bytes',()=>{
 storage();writeSourceSession({...imported,replayView:'imported'});
 const original=readSourceSession().replay;
 for(const view of ['backend','bundled','imported']){
  selectReplayView(view);assert.equal(readReplayView(),view);
  assert.equal(readSourceSession().mode,'summary');
  assert.deepEqual(readSourceSession().replay,original);
 }
 selectReplayView('backend');
 writeSourceSession(imported);assert.equal(readReplayView(),'backend');
 selectBackendSource();assert.equal(readReplayView(),'backend');
 assert.deepEqual(readSourceSession().replay,original);
});
test('failed Replay view write preserves the selected source and import',()=>{
 storage();writeSourceSession({...imported,replayView:'imported'});
 const before=readSourceSession();
 sessionStorage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>selectReplayView('bundled'),/quota/);
 assert.deepEqual(readSourceSession(),before);
});
