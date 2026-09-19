import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analysisSeries, initialAnalysisSource, prepareAnalysisWorkspace, selectAnalysisSource, summarizeRunAnalysis} from '../lib/rtdi/run-analysis.ts';
import {createDashboardLifecycle} from '../lib/rtdi/ui-lifecycle.ts';
import {readSourceSession,writeSourceSession} from '../lib/rtdi/source-session.ts';
import {sourceAge} from '../lib/rtdi/connection-status.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function storage(){const values=new Map();globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};return sessionStorage;}
function event(id,fields={}) {return {event_id:id,type:'evidence',evidence_id:'e-'+id,run_id:'r',tester_id:'t',timestamp:'2026-09-20T09:00:00Z',source_mode:'replay',...fields};}
function snapshot(events=[],evidence=events.filter(e=>e.type==='evidence')) {return {run:{run_id:'r',tester_id:'t',edge_id:'grp6-recorded-capture',mode:'replay',lot_id:null,wafer_id:null,last_event_at:'2026-09-20T09:00:00Z',data_quality:'partial'},events,evidence,incidents:[],commands:[]};}

test('analysis counts actual records and valid prediction joins without manufacturing yield or full measurements',()=>{
  const predicted=event('p',{type:'prediction',request_id:'req',device_id:'d',site_id:1,stage:2,prediction:0,wafer_id:'W7',lot_id:'L2'});
  const actual=event('a',{type:'prediction_actual',request_id:'req',device_id:'d',site_id:1,stage:2,actual:0,wafer_id:'W7',lot_id:'L2'});
  const e=event('alert',{site_series:{'1':[1,2,3]},wafer_id:'W8',lot_id:'L2',current_value:.5,kind:'low_yield'});
  const data=snapshot([predicted,actual,e,event('m',{type:'measurement',value:0,test_name:'sample'})]);
  const overview=summarizeRunAnalysis(data);
  assert.equal(overview.eventCount,4);assert.equal(overview.evidence,1);
  assert.equal(overview.predictions.length,1);assert.equal(overview.matchedActuals,1);
  assert.equal(overview.predictions[0].actual,0);assert.equal(overview.measurements,1);
  assert.deepEqual(overview.yields,[]);assert.deepEqual(overview.wafers,['W7','W8']);assert.deepEqual(overview.lots,['L2']);
});

test('provided zero yield stays scoped and latest first; absent yield and conflicting actuals stay missing',()=>{
  const events=[event('older',{type:'run_summary',yield:1,wafer_id:'1'}),event('zero',{type:'run_summary',yield:0,wafer_id:'2',timestamp:'2026-09-20T09:01:00Z'})];
  const overview=summarizeRunAnalysis(snapshot(events));
  assert.deepEqual(overview.yields.map(e=>[e.wafer_id,e.yield]),[['2',0],['1',1]]);
  assert.equal(events[0].event_id,'older');
  assert.equal(summarizeRunAnalysis(snapshot()).yields.length,0);
  const p=event('p',{type:'prediction',request_id:'q',device_id:'d',stage:1,prediction:1});
  const a=event('a',{type:'prediction_actual',request_id:'q',device_id:'d',stage:1,actual:1});
  assert.equal(summarizeRunAnalysis(snapshot([p,a,{...a,event_id:'a2'}])).matchedActuals,0);
});

test('site charts use supplied series only and do not overlay measurement scales on yield',()=>{
  const e=event('e',{site_series:{'1':[1,2],'2':[]},series:[.6,.7]});
  assert.deepEqual(analysisSeries(e),[{site:'1',values:[1,2]}]);
  assert.deepEqual(analysisSeries({...e,kind:'low_yield'}),[{site:null,values:[.6,.7]}]);
  assert.deepEqual(analysisSeries(event('empty')),[]);
});

test('switching backend/archive preserves full imported JSON and selection',()=>{
  storage();assert.equal(initialAnalysisSource(),'backend');
  const data=JSON.parse(readFileSync(new URL('../public/replay/summary.json',import.meta.url),'utf8'));
  const replay={data,filename:'saved.json',selection:{waferId:'14',alertIndex:0,filter:'all',tab:'validation',detailOpen:false}};
  writeSourceSession({version:1,mode:'summary',replay});
  const persistedReplay=readSourceSession().replay;
  assert.equal(initialAnalysisSource(),'archive');
  selectAnalysisSource('backend');assert.equal(initialAnalysisSource(),'backend');
  assert.deepEqual(readSourceSession().replay,persistedReplay);
  selectAnalysisSource('archive');assert.equal(initialAnalysisSource(),'archive');
  assert.deepEqual(readSourceSession().replay,persistedReplay);
});

test('analysis uses lifecycle SSE refreshes and persists exact run/tester handoff to workspace',async()=>{
  const cache=storage(),streams=[],requests=[];
  let payload=snapshot([event('first')]);
  const controller=createDashboardLifecycle({fetch:async url=>{requests.push(url);return Response.json(payload);},eventSource:url=>{
    const handlers=new Map();const stream={url,closed:false,onerror:null,addEventListener:(type,callback)=>handlers.set(type,callback),close(){this.closed=true;},emit:type=>handlers.get(type)?.()};streams.push(stream);return stream;
  }},()=>{}, {conversationStorage:cache});
  await controller.connect('r','');
  assert.equal(streams[0].url,'/api/v1/runs/r/events?tester_id=t');
  prepareAnalysisWorkspace(controller.getState().scope,cache);
  assert.equal(readSourceSession().mode,'backend');
  streams[0].emit('ready');await tick();
  assert.equal(controller.getState().status,'Event stream connected');
  payload=snapshot([event('first'),event('second')]);
  payload.run.last_event_at='2026-09-20T09:01:00Z';
  streams[0].emit('edge_event');await tick();
  assert.equal(summarizeRunAnalysis(controller.getState().data).evidence,2);
  const age=sourceAge(controller.getState().data.run.last_event_at,Date.parse('2026-09-20T10:00:00Z'));
  streams[0].emit('heartbeat');await tick();
  assert.deepEqual(sourceAge(controller.getState().data.run.last_event_at,Date.parse('2026-09-20T10:00:00Z')),age);
  assert.ok(requests.every(url=>url.startsWith('/api/v1/runs/r')));
  assert.ok(!requests.some(url=>url.includes('summary.json')||url.includes('/chat')));
  controller.dispose();assert.equal(streams[0].closed,true);
  let restoredUrl='';
  const workspace=createDashboardLifecycle({fetch:async url=>{restoredUrl=url;return Response.json(payload);},eventSource:()=>({addEventListener(){},close(){},onerror:null})},()=>{},{conversationStorage:cache});
  await workspace.restoreSession();assert.equal(restoredUrl,'/api/v1/runs/r?tester_id=t');workspace.dispose();
});

test('workspace handoff fails visibly if browser persistence cannot preserve the selected scope',()=>{
  const cache=storage();assert.throws(()=>prepareAnalysisWorkspace({run:'r',tester:'t'},cache),/could not be saved/);
  sessionStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>selectAnalysisSource('backend'),/quota/);
});
