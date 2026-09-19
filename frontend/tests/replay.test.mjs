import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseReplay,replayTotals,waferState,replayChart} from '../lib/rtdi/replay.ts';
const raw=JSON.parse(readFileSync(new URL('../public/replay/summary.json',import.meta.url),'utf8'));
test('source replay displays supplied counts without deriving detector performance',()=>{
 const data=parseReplay(raw);assert.equal(data.wafers.length,25);assert.equal(replayTotals(data).devices,2000);assert.equal(replayTotals(data).alerts,14);
 const w=data.wafers.find(w=>w.wafer==='25');assert.equal(waferState(w),'quiet');assert.notEqual(w.expected,'normal');assert.equal('missed' in replayTotals(data),false);
});
test('reject live data and duplicate wafer identity rather than misrepresenting source',()=>{
 assert.throws(()=>parseReplay({...raw,mode:'live'}));assert.throws(()=>parseReplay({...raw,wafers:[raw.wafers[0],raw.wafers[0]]}));
});
test('yield plot uses source cumulative series, other plots preserve site series',()=>{
 const alerts=parseReplay(raw).wafers.flatMap(w=>w.alerts);const yieldAlert=alerts.find(a=>a.kind==='low_yield');assert.deepEqual(replayChart(yieldAlert)[0].values,yieldAlert.series);
 const siteAlert=alerts.find(a=>a.kind!=='low_yield'&&Object.values(a.site_series).some(s=>s.length));assert.deepEqual(replayChart(siteAlert).map(l=>l.values),Object.values(siteAlert.site_series).filter(s=>s.length));
});
