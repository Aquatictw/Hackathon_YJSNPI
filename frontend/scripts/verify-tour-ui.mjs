// Local guide regression. Snapshot/SSE are test doubles; no external or mutation requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {tourSteps, tourIndices} from '../lib/rtdi/tour-steps.ts';
import {parseReplay} from '../lib/rtdi/replay.ts';
const base = new URL(process.argv[2] || 'http://localhost:5173').origin;
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
const summary = parseReplay(JSON.parse(await readFile(new URL('../public/replay/summary.json',import.meta.url),'utf8')));
const event = {event_id:'tour-event',type:'evidence',source_mode:'replay',run_id:'tour-run',tester_id:'tour-tester',timestamp:'2026-09-19T00:00:00Z',wafer_id:'1',evidence_id:'tour-evidence',kind:'mean_drift_up',severity:'warning',message:'Synthetic browser evidence',current_value:2,baseline:1,score:3,series:[1,1.5,2]};
const snapshot = {run:{run_id:event.run_id,tester_id:event.tester_id,edge_id:'tour',mode:'replay',lot_id:null,wafer_id:'1',data_quality:'partial',last_event_at:event.timestamp},events:[event],evidence:[event],incidents:[],commands:[]};
const blocked=[],checks=[];
const sessionKey='rtdi.source-session.v1';
const savedKey='rtdi-guided-tour-v2';
async function check(name, fn){await fn();checks.push(name);console.log('PASS '+name);}
async function isolated({locale='en',source='backend',loaded=false,width=1440,fresh=false,deny=false}={}){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addCookies([{name:'rtdi.locale',value:locale,url:base}]);
  await context.addInitScript(({locale,source,loaded,fresh,deny,summary,sessionKey})=>{
    if(deny){for(const key of ['sessionStorage','localStorage'])Object.defineProperty(window,key,{get(){throw new DOMException('Denied','SecurityError');}});return;}
    localStorage.setItem('rtdi.locale',locale);
    if(!fresh)localStorage.setItem('rtdi-guided-tour-visit-v1',JSON.stringify({version:1,status:'dismissed'}));
    if(!sessionStorage.getItem('tour-test-initialized')){
      sessionStorage.setItem('tour-test-initialized','1');
      if(source==='archive')sessionStorage.setItem(sessionKey,JSON.stringify({version:1,mode:'summary',replay:{data:summary,filename:'guide-test.json',selection:{waferId:String(summary.wafers.find(w=>w.alerts.length).wafer),alertIndex:0,filter:'all',tab:'analysis',detailOpen:true}}}));
      if(loaded)sessionStorage.setItem('rtdi.dashboard.conversations.v1',JSON.stringify({version:1,lastScope:{run:'tour-run',tester:'tour-tester'},selections:[],conversations:[]}));
    }
  },{locale,source,loaded,fresh,deny,summary,sessionKey});
  await context.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(!['GET','HEAD'].includes(req.method()) || url.origin!==base){blocked.push(req.method()+' '+req.url());return route.abort();}
    if(url.pathname==='/api/config')return route.fulfill({json:{openai_configured:true,backend_connected:true,model:'browser-test-double'}});
    if(url.pathname==='/api/v1/runs')return route.fulfill({json:{runs:[{...snapshot.run,updated_at:event.timestamp}],next_offset:null}});
    if(url.pathname==='/api/v1/runs/tour-run')return route.fulfill({json:snapshot});
    if(url.pathname==='/api/v1/runs/tour-run/events')return route.fulfill({contentType:'text/event-stream',body:'retry: 60000\nevent: ready\ndata: {"cursor":1}\n\n'.replaceAll('\\n','\n')});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{error:'Unmocked guide test API'}});
    return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  return {context,page,errors};
}
async function ready(page){await page.locator('.app-guide:not(:disabled)').waitFor();}
async function open(page,route){await page.locator('.app-guide').click();await page.locator('.rtdi-tour-chapters a[href="'+route+'"]').click();}
async function step(page,id){await page.locator('.rtdi-tour-card[data-step="'+id+'"]').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='rtdi-tour-title');}
async function close(page){await page.keyboard.press('Escape');await page.locator('.rtdi-tour-card').waitFor({state:'detached'});assert.equal(await page.locator('.app-guide').evaluate(el=>el===document.activeElement),true);}
async function chapter(page,route,source){
  const steps=tourIndices(route,source).map(i=>tourSteps[i]).filter(s=>s.route===route);
  for(let i=0;i<steps.length;i++){
    await step(page,steps[i].id);
    await page.locator('.rtdi-tour-spotlight').waitFor();
    await page.waitForFunction(()=>{const r=document.querySelector('.rtdi-tour-card').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
    if(i<steps.length-1)await page.locator('.rtdi-tour-next').click();
  }
}
try{
  await check('Home starts Workspace, then backend Replay, then Sandbox; Back respects source',async()=>{
    const {page,context,errors}=await isolated({loaded:true,fresh:true});
    try{
      await page.goto(base);await ready(page);await page.locator('[data-step="chapters"]').waitFor();
      assert.deepEqual(await page.locator('.rtdi-tour-chapters a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),['/workspace','/replay','/sandbox']);
      await page.locator('.rtdi-tour-next').click();await step(page,'workspace');assert.equal(new URL(page.url()).pathname,'/');
      await page.locator('.dc-loaded-run').waitFor();await chapter(page,'/workspace','workspace-backend');
      await page.locator('.rtdi-tour-next').click();await step(page,'analysis-source');assert.equal(new URL(page.url()).pathname,'/replay');
      await page.locator('.dc-loaded-run').waitFor();await chapter(page,'/replay','replay-backend');
      await page.locator('.rtdi-tour-next').click();await step(page,'sandbox');
      await page.locator('.rtdi-tour-back').click();await step(page,'analysis-temperature');
      await page.locator('.rtdi-tour-next').click();await step(page,'sandbox');await chapter(page,'/sandbox',null);
      await page.locator('.rtdi-tour-next').click();await page.locator('.rtdi-tour-card').waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rtdi-guided-tour-visit-v1')).status),'completed');
      await page.reload();await ready(page);assert.equal(await page.locator('.rtdi-tour-card').count(),0);assert.deepEqual(errors,[]);
    }finally{await context.close();}
  });
  for(const locale of ['en','zh-TW'])await check(locale+': archive and imported Workspace preserve source and selection',async()=>{
    const {page,context,errors}=await isolated({source:'archive',locale});
    try{
      await page.goto(base+'/workspace');await ready(page);await page.locator('.isw-source').waitFor();
      const before=await page.evaluate(key=>sessionStorage.getItem(key),sessionKey);
      await open(page,'/workspace');await chapter(page,'/workspace','workspace-summary');
      await page.locator('.rtdi-tour-next').click();await step(page,'analysis-source');await chapter(page,'/replay','replay-archive');
      await close(page);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),sessionKey),before);
      await open(page,'/replay');await page.locator('.rtdi-tour-next').click();await step(page,'overview');await page.reload();await step(page,'overview');await close(page);
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  });
  await check('Empty backend shows a load prerequisite without switching to the archive',async()=>{
    const {page,context}=await isolated();try{
      await page.goto(base+'/replay');await ready(page);await open(page,'/replay');
      for(let i=0;i<4;i++)await page.locator('.rtdi-tour-next').click();await step(page,'analysis-evidence');
      await page.locator('.rtdi-tour-notice').filter({hasText:'load a backend run'}).waitFor();
      assert.equal(await page.locator('.replay-workspace').count(),0);await close(page);
    }finally{await context.close();}
  });
  await check('Hidden analysis draft and Q&A history block navigation; picker changes are guarded',async()=>{
    const {page,context}=await isolated({loaded:true});try{
      await page.goto(base+'/workspace');await ready(page);await page.locator('.dc-loaded-run').waitFor();
      await page.locator('#investigation-question').fill('keep analysis draft');
      await page.getByRole('button',{name:'Semiconductor Q&A',exact:true}).click();
      await open(page,'/replay');await page.locator('.rtdi-tour-notice[role="alert"]').waitFor();assert.equal(new URL(page.url()).pathname,'/workspace');await close(page);
      await page.getByRole('button',{name:'Selected analysis',exact:true}).click();assert.equal(await page.locator('#investigation-question').inputValue(),'keep analysis draft');await page.locator('#investigation-question').fill('');
      await page.getByRole('button',{name:'Semiconductor Q&A',exact:true}).click();await page.locator('#knowledge-question').fill('keep Q&A draft');
      await open(page,'/replay');await page.locator('.rtdi-tour-notice[role="alert"]').filter({hasText:'General Q&A'}).waitFor();await close(page);
      await page.locator('#knowledge-question').fill('');
      // A historical answer is local page state; no model request is needed to test its guard.
      await page.locator('#knowledge-question').evaluate(el=>{const chat=el.closest('form').parentElement.querySelector('.dc-chat');const answer=document.createElement('div');answer.className='dc-chat-message';answer.textContent='Synthetic saved answer';chat.append(answer);});
      await open(page,'/sandbox');await page.locator('.rtdi-tour-notice[role="alert"]').filter({hasText:'General Q&A'}).waitFor();await close(page);
      await page.goto(base+'/replay');await ready(page);await page.locator('.dc-connect select').selectOption({index:1});
      await open(page,'/sandbox');await page.locator('.rtdi-tour-notice[role="alert"]').filter({hasText:'run input'}).waitFor();await close(page);
    }finally{await context.close();}
  });
  await check('Sandbox practice data blocks route changes and guide never receives another example',async()=>{
    const {page,context}=await isolated();try{
      await page.goto(base+'/sandbox');await ready(page);await page.getByRole('button',{name:'Load practice example',exact:true}).click();
      const count=await page.locator('.inbox-item').count();assert.ok(count>0);
      await open(page,'/sandbox');await chapter(page,'/sandbox',null);await close(page);assert.equal(await page.locator('.inbox-item').count(),count);
      await open(page,'/workspace');await page.locator('.rtdi-tour-notice[role="alert"]').filter({hasText:'sandbox contains'}).waitFor();await close(page);
    }finally{await context.close();}
  });
  await check('Quiet wafer and collapsed detail keep an explicit missing-target fallback',async()=>{
    const {page,context}=await isolated({source:'archive'});try{
      await page.goto(base+'/replay');await ready(page);await page.getByLabel('Filter wafers',{exact:true}).selectOption('quiet');
      const selected=await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label');
      await open(page,'/replay');while(await page.locator('.rtdi-tour-card').getAttribute('data-step')!=='alerts')await page.locator('.rtdi-tour-next').click();
      await page.locator('.rtdi-tour-notice').filter({hasText:'target is not available'}).waitFor();await close(page);assert.equal(await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label'),selected);
      await page.locator('.wafer-tile[aria-pressed="true"]').click();await open(page,'/replay');while(await page.locator('.rtdi-tour-card').getAttribute('data-step')!=='yield')await page.locator('.rtdi-tour-next').click();
      await page.locator('.rtdi-tour-notice').filter({hasText:'panel may be collapsed'}).waitFor();await close(page);assert.equal(await page.locator('.replay-detail').evaluate(el=>el.hidden),true);
    }finally{await context.close();}
  });
  await check('320px bilingual guide contains focus, fits the screen and respects reduced motion',async()=>{
    const {page,context}=await isolated({width:320});try{
      await page.goto(base+'/sandbox');await ready(page);await open(page,'/sandbox');await chapter(page,'/sandbox',null);
      for(const locale of ['en','zh-TW']){
        await page.locator('.rtdi-tour-language select').selectOption(locale);
        await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
        for(let i=0;i<12;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert.equal(await page.locator('.rtdi-tour-card').evaluate(el=>el.contains(document.activeElement)),true);}
        assert.equal(await page.locator('.rtdi-tour-card').evaluate(el=>getComputedStyle(el).animationName),'none');
      }await close(page);
    }finally{await context.close();}
  });
  await check('Denied session storage blocks cross-page continuation safely',async()=>{
    const {page,context,errors}=await isolated({deny:true});try{
      await page.goto(base+'/workspace');await ready(page);await page.locator('.rtdi-tour-chapters a[href="/sandbox"]').click();
      await page.locator('.rtdi-tour-notice[role="alert"]').filter({hasText:'session storage is unavailable'}).waitFor();assert.equal(new URL(page.url()).pathname,'/workspace');await close(page);assert.deepEqual(errors,[]);
    }finally{await context.close();}
  });
  await check('Saved step from an inactive source resumes at the source chooser',async()=>{
    const {page,context}=await isolated();try{
      await page.goto(base+'/replay');await ready(page);
      await page.evaluate(key=>sessionStorage.setItem(key,JSON.stringify({version:2,id:'validation',expires:Date.now()+60000})),savedKey);
      await page.reload();await step(page,'analysis-source');await close(page);
    }finally{await context.close();}
  });
  assert.deepEqual(blocked,[]);console.log(JSON.stringify({passed:true,checks:checks.length,blockedRequests:blocked,limits:'Local guide UI with backend test doubles; no live machine, model or deployment acceptance.'},null,2));
}finally{await browser.close();}
