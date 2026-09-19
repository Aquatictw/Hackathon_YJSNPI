// Browser-only fixtures; every POST is blocked, including model requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=(process.argv[2]||'http://localhost:5173').replace(/\/$/,'');
const output=resolve(process.env.WAFER_UI_OUTPUT||'.wrangler/wafer-ui');
await mkdir(output,{recursive:true});
const report={base,checkedAt:new Date().toISOString(),paidCalls:0,checks:[],errors:[]};
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('rtdi-guided-tour-visit-v1',JSON.stringify({version:1,status:'dismissed'})));
 await context.route('**/*',route=>route.request().method()==='POST'?route.abort('blockedbyclient'):route.fallback());
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('.wafer-tile').first().waitFor();
 const summary=await (await context.request.get(base+'/replay/summary.json')).json();
 const selected=page.locator('.wafer-tile.active');
 const selectedId=await page.locator('.wafer-scene').getAttribute('data-wafer');
 await selected.click();
 assert.equal(await page.locator('#replay-wafer-detail').isVisible(),false);
 assert.equal(await selected.getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('.wafer-scene').getAttribute('data-wafer'),selectedId);
 await selected.click();
 assert.equal(await page.locator('#replay-wafer-detail').isVisible(),true);
 assert.equal(await selected.getAttribute('aria-expanded'),'true');
 const alpha=await page.locator('#replay-wafer-detail').evaluate(node=>{const pixel=document.createElement('canvas').getContext('2d');pixel.fillStyle=getComputedStyle(node).backgroundColor;pixel.fillRect(0,0,1,1);return pixel.getImageData(0,0,1,1).data[3]/255;});
 assert.ok(Math.abs(alpha-.9)<.01,'Detail surface should be 90% opaque');
 report.checks.push('Selected wafer toggles its detail panel without clearing selection; detail background is 90% opaque');
 for(const index of [0,1,2,24]){
  await page.locator('.wafer-tile').nth(index).click();
  const wafer=summary.wafers[index];
  assert.equal(await page.locator('.wafer-scene').getAttribute('data-wafer'),String(wafer.wafer));
  assert.equal(await page.locator('[data-die="true"][data-failed="true"]').count(),Math.round((1-wafer.yield)*400));
 }
 report.checks.push('Selected real replay wafer controls failure share without changing evidence');
 const importInput=page.locator('input[type=file]');
 const fixture=structuredClone(summary);fixture.wafers=[{...fixture.wafers[0],wafer:'ui-yield-example'}];
 for(const [ratio,red] of [[1,0],[.95,20],[.5,200],[0,400]]){
  fixture.wafers[0].yield=ratio;
  await importInput.setInputFiles({name:'browser-only-yield.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(expected=>document.querySelector('.wafer-scene')?.dataset.failedTiles===String(expected),red);
  assert.equal(await page.locator('[data-die="true"]').count(),400);
  assert.equal(await page.locator('[data-die="true"][data-failed="true"]').count(),red);
 }
 report.checks.push('Browser-only 100%, 95%, 50%, 0% yield imports render exactly 0, 20, 200, 400 red dies');
 await page.reload({waitUntil:'networkidle'});await page.locator('.wafer-tile').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.wafer-scene')?.dataset.running==='true');
 const style=()=>page.locator('.wafer-scene__stage').getAttribute('style');
 await page.mouse.move(100,200);await page.waitForTimeout(60);const left=await style();
 await page.mouse.move(1300,800);await page.waitForTimeout(60);assert.notEqual(await style(),left);
 const beforeScroll=await style();await page.evaluate(()=>window.scrollTo(0,450));await page.waitForTimeout(100);assert.notEqual(await style(),beforeScroll);
 report.checks.push('Window pointer changes wafer facing; document scroll changes wafer rotation');
 await page.getByRole('button',{name:'Pause wafer motion',exact:true}).click();const paused=await style();
 await page.mouse.move(300,300);await page.evaluate(()=>window.scrollTo(0,300));await page.waitForTimeout(100);assert.equal(await style(),paused);
 await page.getByRole('button',{name:'Top view',exact:true}).click();assert.equal(await page.locator('.wafer-scene').getAttribute('data-top-view'),'true');
 await page.getByRole('button',{name:'Top view',exact:true}).click();
 await page.getByRole('button',{name:'Resume wafer motion',exact:true}).click();
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Animation disabled by reduced-motion preference'}).waitFor();
 assert.equal(await page.locator('.wafer-scene').getAttribute('data-running'),'false');
 report.checks.push('Pause, top view and reduced motion remain functional');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
  for(const theme of ['light','dark']){
   await page.getByLabel('Color theme').selectOption(theme);
   await page.waitForFunction(expected=>document.documentElement.classList.contains(expected),theme);
   await page.waitForTimeout(250);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Document must not overflow');
   await page.screenshot({path:resolve(output,'wafer-'+width+'-'+theme+'.png'),fullPage:false});
  }
 }
 report.checks.push('Light/dark at desktop and 390px fit viewport');
 for(const path of ['/','/workspace','/sandbox']){
  await page.goto(base+path,{waitUntil:'networkidle'});
  assert.match(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundImage),/radial-gradient/);
  if(path==='/workspace')assert.equal(await page.locator('.dc-app').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
 }
 report.checks.push('Sparse dotted background shared by all three pages');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;}
finally{await browser.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
