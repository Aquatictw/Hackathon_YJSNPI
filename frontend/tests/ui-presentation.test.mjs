import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {displayNumber, investigationAvailability, waferEvaluation, replaySelection} from '../lib/rtdi/ui-presentation.ts';

test('display precision retains missing, zero and very small/large values without changing evidence', () => {
  assert.equal(displayNumber(null), '未提供'); assert.equal(displayNumber(undefined), '未提供');
  assert.equal(displayNumber(NaN), '未提供'); assert.equal(displayNumber(0), '0');
  const evidence = {prediction: 29.197315625834765};
  assert.equal(displayNumber(evidence.prediction), '29.1973'); assert.equal(evidence.prediction, 29.197315625834765);
  assert.equal(displayNumber(0.00000003), '3.000e-8'); assert.equal(displayNumber(12345678), '1.235e+7');
});
test('AI is unavailable until both config and backend are ready, with retry guidance', () => {
  for(const config of [null,{openai_configured:false,backend_connected:true},{openai_configured:true,backend_connected:false}]) assert.equal(investigationAvailability(config,false).enabled,false);
  assert.match(investigationAvailability(null,true).message,/重新/);
  assert.match(investigationAvailability({openai_configured:false,backend_connected:true},false).message,/固定規則/);
  assert.equal(investigationAvailability({openai_configured:true,backend_connected:true},false).enabled,true);
});
test('replay evaluation follows source metadata for any wafer, including a future promoted result', () => {
  const wafer={wafer:'25',expected:'spread_down',expected_first_device:null};
  assert.match(waferEvaluation(wafer),/未偵測/);
  assert.match(waferEvaluation({...wafer,wafer:'99'}),/未偵測/);
  assert.match(waferEvaluation({...wafer,expected_first_device:40}),/40/);
  assert.equal(waferEvaluation({...wafer,expected:'normal'}),null);
});

const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
function luminance(hex){const rgb=hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
for(const selector of [':root','.dark']) test(`${selector} text, input, warning and chart tokens maintain contrast`,()=>{
  const block=css.slice(css.indexOf(`${selector}{`)).split('}')[0];const tokens=Object.fromEntries([...block.matchAll(/--([\w-]+):(#[a-f\d]{6})/gi)].map(m=>[m[1],m[2]]));
  const ratio=(a,b)=>{const values=[luminance(tokens[a]),luminance(tokens[b])].sort((a,b)=>a-b);return (values[1]+.05)/(values[0]+.05);};
  for(const surface of ['background','card','muted','popover'])for(const ink of ['foreground','muted-foreground'])assert.ok(ratio(ink,surface)>=4.5,`${ink}/${surface}: ${ratio(ink,surface)}`);
  assert.ok(ratio('primary-foreground','primary')>=4.5);
  assert.ok(ratio('input','card')>=3); assert.ok(ratio('ring','card')>=3);
  assert.ok(ratio('warning','warning-surface')>=4.5);
  for(const chart of ['chart-1','chart-2','chart-3','chart-4','chart-5'])assert.ok(ratio(chart,'card')>=3,chart);
});

test('replay selection follows filters and recovers after a filter has no results', () => {
  const wafers=[{wafer:'1',alerts:[{}]},{wafer:'25',alerts:[]}];
  assert.equal(replaySelection(wafers,'25','alert'),'1');
  assert.equal(replaySelection(wafers,'25','all'),'25');
  assert.equal(replaySelection([wafers[0]],'1','quiet'),'');
  assert.equal(replaySelection([wafers[0]],'','all'),'1');
});
