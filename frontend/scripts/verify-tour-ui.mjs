// Local, isolated tour acceptance. Every non-GET/HEAD request is blocked.
// Reuses an installed Playwright runtime; no downloads or model requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

const rawBase=process.argv[2] || 'http://localhost:5173';
const base=rawBase.endsWith('/') ? rawBase.slice(0,-1) : rawBase;
const url=new URL(base);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Loopback preview required');
assert.ok(['http:','https:'].includes(url.protocol));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const blocked=[];
const safeRoute=async route=>{
  const request=route.request();
  if (!['GET','HEAD'].includes(request.method())) {blocked.push(request.url());return route.abort();}
  if (!request.url().startsWith(base) && !request.url().startsWith('data:')) return route.abort();
  return route.continue();
};
await context.route('**/*',safeRoute);
const page=await context.newPage();
page.setDefaultTimeout(10000);
const checks=[];
const dialog=()=>page.locator('.rtdi-tour-card');
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function ready(){await page.locator('.app-guide:not(:disabled)').waitFor();await page.waitForFunction(()=>!document.querySelector('main[aria-busy="true"]'));}
async function guide(){await page.locator('.app-guide').click();await page.locator('[data-step="chapters"]').waitFor();}
async function chapter(route){await page.locator('.rtdi-tour-chapters a[href="'+route+'"]').click();await page.locator('.rtdi-tour-progress').waitFor();}
async function step(id){await page.locator('.rtdi-tour-card[data-step="'+id+'"]').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='rtdi-tour-title');}
async function close(){await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});assert.equal(await page.locator('.app-guide').evaluate(el=>document.activeElement===el),true);}
async function bounds(){
  await page.waitForFunction(()=>{const el=document.querySelector('.rtdi-tour-card');if(!el)return false;const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
  const small=await dialog().evaluate(el=>[...el.querySelectorAll('*')].filter(n=>n.getClientRects().length&&[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())&&parseFloat(getComputedStyle(n).fontSize)<14).map(n=>n.textContent));
  assert.deepEqual(small,[],'Guide text below 14px');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Page overflows');
}
try {
  await page.goto(base);await ready();
  await check('Fresh first visit automatically opens welcome with Start tour',async()=>{
    await page.locator('[data-step="chapters"]').waitFor();
    await page.getByRole('link',{name:'Start tour',exact:true}).waitFor();
    assert.equal(await dialog().count(),1);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rtdi-guided-tour-visit-v1'))),{version:1,status:'seen'});
    await bounds();
  });
  await check('Modal keyboard trap, Escape and focus restoration',async()=>{
    await page.keyboard.press('Shift+Tab');assert.equal(await dialog().evaluate(el=>el.contains(document.activeElement)),true);
    for(let i=0;i<9;i++)await page.keyboard.press('Tab');
    assert.equal(await dialog().evaluate(el=>el.contains(document.activeElement)),true);
    assert.equal(await page.locator('main').evaluate(el=>Boolean(el.closest('[inert]'))),true);
    await close();assert.equal(await page.locator('main').evaluate(el=>Boolean(el.closest('[inert]'))),false);
  });
  await check('Dismissal persists after reload and Guide manually reopens',async()=>{
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rtdi-guided-tour-visit-v1')).status),'dismissed');
    await page.reload();await ready();assert.equal(await dialog().count(),0);
    await guide();await page.getByRole('link',{name:'Start tour',exact:true}).click();await step('overview');await close();
    const other=await context.newPage();await other.goto(base+'/workspace');await other.locator('.app-guide:not(:disabled)').waitFor();
    assert.equal(await other.locator('.rtdi-tour-card').count(),0);await other.close();
  });
  await page.getByLabel('Filter wafers',{exact:true}).selectOption('alert');
  await guide();await chapter('/');
  const ids=['overview','totals','filter','wafer','yield','alerts','series','import','validation','limitations','load','stream','evidence','temperature','commands','investigate','cost','sandbox','fixtures','sandbox-evidence','rule-demo','finish'];
  await check('All 22 steps, real targets and native cross-page continuation',async()=>{
    for(let i=0;i<ids.length;i++){
      await step(ids[i]);await bounds();console.log('STEP '+ids[i]);
      await page.locator('.rtdi-tour-spotlight').waitFor().catch(async error=>{console.log(await page.evaluate(()=>({step:document.querySelector('.rtdi-tour-card')?.getAttribute('data-step'),card:document.querySelector('.rtdi-tour-card')?.getBoundingClientRect().toJSON(),alert:document.querySelector('.alert-selector')?.getBoundingClientRect().toJSON(),notice:document.querySelector('.rtdi-tour-notice')?.textContent})));throw error;});
      if(i===8)await page.locator('.model-panel').waitFor();
      if(i===13)await page.locator('.dc-temperature').waitFor();
      if(i===14)await page.locator('.dc-command-list').waitFor();
      if(i===10)assert.equal(new URL(page.url()).pathname,'/workspace');
      if(i===17)assert.equal(new URL(page.url()).pathname,'/sandbox');
      if(i<ids.length-1)await page.locator('.rtdi-tour-next').click();
    }
    await page.getByRole('button',{name:'Finish',exact:true}).click();await dialog().waitFor({state:'detached'});
    assert.equal(await page.locator('.app-guide').evaluate(el=>document.activeElement===el),true);
  });
  await check('Reload resumes the same step; close clears continuation',async()=>{
    await guide();await chapter('/sandbox');await page.locator('.rtdi-tour-next').click();await step('fixtures');await page.reload();await step('fixtures');await close();await page.reload();await ready();assert.equal(await dialog().count(),0);
  });
  await check('Completion persists and unrelated visits do not restore a step',async()=>{
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rtdi-guided-tour-visit-v1')).status),'completed');
    await page.evaluate(()=>sessionStorage.setItem('rtdi-guided-tour-v1',JSON.stringify({version:1,id:'overview',expires:Date.now()+60000})));
    await page.reload();await ready();assert.equal(await dialog().count(),0);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('rtdi-guided-tour-v1')),null);
    await page.goto(base);await ready();assert.equal(await dialog().count(),0);
    await page.goto(base+'/sandbox');await ready();
  });
  await check('Drafts survive guide and prevent destructive route changes',async()=>{
    await page.goto(base+'/workspace');await ready();await page.locator('.dc-connect input').first().fill('tour-unsent-scope');
    await guide();await page.locator('.rtdi-tour-chapters a[href="/sandbox"]').click();await page.getByRole('alert').filter({hasText:'run input'}).waitFor();assert.equal(new URL(page.url()).pathname,'/workspace');await close();assert.equal(await page.locator('.dc-connect input').first().inputValue(),'tour-unsent-scope');
    await page.goto(base+'/sandbox');await ready();await page.getByRole('tab',{name:'Message JSON',exact:true}).click();await page.locator('#batch-json').fill('draft JSON kept locally');
    await guide();await page.locator('.rtdi-tour-chapters a[href="/workspace"]').click();await page.getByRole('alert').filter({hasText:'sandbox contains'}).waitFor();await close();assert.equal(await page.locator('#batch-json').inputValue(),'draft JSON kept locally');
  });
  await check('Local import remains intact across guide navigation',async()=>{
    await page.goto(base);await ready();
    const summary=await readFile(new URL('../public/replay/summary.json',import.meta.url));
    await page.locator('input[type="file"]').setInputFiles({name:'tour-local-copy.json',mimeType:'application/json',buffer:summary});
    await page.locator('.replay-source').filter({hasText:'Local import'}).waitFor();
    await guide();await page.locator('.rtdi-tour-chapters a[href="/workspace"]').click();await page.waitForURL('**/workspace');await ready();await page.locator('.rtdi-tour-progress').waitFor();await close();
    await page.goto(base);await ready();assert.match(await page.locator('.replay-source').innerText(),/tour-local-copy.json/);
  });
  await check('Missing alert target is explicit and preserves selected wafer/filter',async()=>{
    await page.goto(base);await ready();await page.getByLabel('Filter wafers',{exact:true}).selectOption('quiet');
    const selected=await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label');
    await guide();await chapter('/');for(let i=0;i<5;i++)await page.locator('.rtdi-tour-next').click();await step('alerts');
    await page.getByRole('status').filter({hasText:'target is not available'}).waitFor();await close();assert.equal(await page.getByLabel('Filter wafers',{exact:true}).inputValue(),'quiet');assert.equal(await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label'),selected);
  });
  await check('Mobile 390px and 320px placement, readable text and reduced motion',async()=>{
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await page.goto(base);await ready();await guide();await bounds();await chapter('/');
      for(let i=0;i<3;i++){await bounds();await page.locator('.rtdi-tour-next').click();}
      await bounds();assert.equal(await dialog().evaluate(el=>getComputedStyle(el).animationName),'none');await close();
    }
  });
  await check('Hidden detail panel stays closed with an explicit fallback',async()=>{
    await page.goto(base);await ready();
    await page.locator('.wafer-tile[aria-pressed="true"]').click();
    assert.equal(await page.locator('.replay-detail').isVisible(),false);
    await guide();await chapter('/');for(let i=0;i<4;i++)await page.locator('.rtdi-tour-next').click();
    await step('yield');await page.getByRole('status').filter({hasText:'panel may be collapsed'}).waitFor();await close();
    assert.equal(await page.locator('.replay-detail').evaluate(el=>el.hidden),true);
  });
  await check('Theme class and computed surfaces settle before capture',async()=>{
    await page.goto(base);await ready();
    for(const theme of ['dark','light']){
      await page.locator('.theme-selector select').first().selectOption(theme);
      await page.waitForFunction(theme=>document.documentElement.classList.contains(theme),theme);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await guide();await bounds();
      const color=await dialog().evaluate(el=>getComputedStyle(el).backgroundColor);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await dialog().evaluate(el=>getComputedStyle(el).backgroundColor),color);await close();
    }
  });
  await check('Large Validation and Limitations retain their full visible spotlight',async()=>{
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:900});await page.goto(base);await ready();await guide();await chapter('/');
      for(let i=0;i<8;i++)await page.locator('.rtdi-tour-next').click();
      for(const [id,target] of [['validation','.model-panel'],['limitations','.limitations-panel']]){
        await step(id);await page.locator(target).waitFor();
        // Enlarge only the isolated test DOM so outside placement cannot fit.
        await page.locator(target).evaluate(el=>{el.style.minHeight='1400px';});
        await bounds();
        await page.waitForFunction(selector=>{
          const target=document.querySelector(selector),spot=document.querySelector('.rtdi-tour-spotlight');if(!target||!spot)return false;
          const r=target.getBoundingClientRect(),s=spot.getBoundingClientRect();
          const expected={left:Math.max(0,r.left-6),top:Math.max(0,r.top-6),right:Math.min(innerWidth,r.right+6),bottom:Math.min(innerHeight,r.bottom+6)};
          return Object.entries(expected).every(([key,value])=>Math.abs(s[key]-value)<=1);
        },target);
        // The visible bottom follows the target after scroll clamping; it need
        // not equal the viewport bottom for a compact final panel.
        if(id==='validation')await page.locator('.rtdi-tour-next').click();
      }
      await close();
    }
  });
  await check('Back, chapter chooser and Skip tour work',async()=>{
    await guide();await chapter('/');await page.locator('.rtdi-tour-next').click();await step('totals');await page.getByRole('link',{name:'Back',exact:true}).click();await step('overview');await page.getByRole('button',{name:'Chapters',exact:true}).click();await page.locator('[data-step="chapters"]').waitFor();await chapter('/');await page.getByRole('button',{name:'Skip tour',exact:true}).click();await dialog().waitFor({state:'detached'});
  });
  await check('Denied storage is safe; session fallback remembers dismissal',async()=>{
    for(const denyAll of [false,true]){
      const isolated=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
      await isolated.route('**/*',safeRoute);
      await isolated.addInitScript(denyAll=>{
        for(const key of denyAll?['localStorage','sessionStorage']:['localStorage'])Object.defineProperty(window,key,{get(){throw new DOMException('Storage denied','SecurityError');}});
      },denyAll);
      const view=await isolated.newPage();const errors=[];view.on('pageerror',error=>errors.push(error.message));
      try {
        await view.goto(base);await view.locator('[data-step="chapters"]').waitFor();
        await view.keyboard.press('Escape');await view.locator('.rtdi-tour-card').waitFor({state:'detached'});
        await view.locator('.app-guide').click();await view.locator('[data-step="chapters"]').waitFor();
        if(denyAll){
          await view.locator('.rtdi-tour-chapters a[href="/workspace"]').click();
          await view.getByRole('alert').filter({hasText:'session storage is unavailable'}).waitFor();
          assert.equal(new URL(view.url()).pathname,'/');
          await view.keyboard.press('Escape');
        }else{
          await view.keyboard.press('Escape');await view.reload();await view.locator('.app-guide:not(:disabled)').waitFor();assert.equal(await view.locator('.rtdi-tour-card').count(),0);
        }
        assert.deepEqual(errors,[]);
      }finally{await isolated.close();}
    }
  });
  await check('Fresh workspace, sandbox and replay alias each show welcome',async()=>{
    for(const path of ['/workspace','/sandbox','/replay']){
      const isolated=await browser.newContext({reducedMotion:'reduce'});await isolated.route('**/*',safeRoute);
      try {
        const view=await isolated.newPage();await view.goto(base+path);await view.locator('[data-step="chapters"]').waitFor();
        await view.getByRole('link',{name:'Start tour',exact:true}).waitFor();
        assert.equal(await view.locator('.rtdi-tour-card').count(),1);
        await view.keyboard.press('Escape');await view.reload();await view.locator('.app-guide:not(:disabled)').waitFor();
        assert.equal(await view.locator('.rtdi-tour-card').count(),0);
      } finally {await isolated.close();}
    }
  });
  await check('No POST, model request or data mutation was attempted',async()=>assert.deepEqual(blocked,[]));
  console.log(JSON.stringify({checks:checks.length,passed:true,blockedRequests:blocked,limits:'Local tour UI only; no model or tester acceptance.'},null,2));
} finally {await context.close();await browser.close();}
