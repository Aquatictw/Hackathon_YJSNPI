// Browser acceptance against a running preview. All model requests are mocked.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_EXECUTABLE support an existing bundled runtime.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=(process.argv[2]||'http://localhost:5173').replace(/\/$/,'');
const output=resolve(process.env.UI_AUDIT_OUTPUT||'.wrangler/ui-audit');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
const report={base,checkedAt:new Date().toISOString(),modelCalls:0,simulatedAnswers:0,checks:[],errors:[]};
const check=name=>report.checks.push(name);
async function header(page, active) {
 const nav=page.getByRole('navigation',{name:'Main navigation'});
 assert.deepEqual(await nav.locator('a').evaluateAll(nodes=>nodes.map(node=>({href:node.getAttribute('href'),text:node.textContent.trim()}))),[
  {href:'/',text:'Replay analysis'},{href:'/workspace',text:'Run workspace'},{href:'/sandbox',text:'Sandbox'}]);
 assert.equal(await nav.locator('a[aria-current="page"]').getAttribute('href'),active);
}
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(error.message));
 await context.route('**/api/config',route=>route.fulfill({json:{openai_configured:true,backend_connected:true,model:'browser-test-double'}}));
 let snapshot;
 await context.route(/\/chat(?:\?|$)/,async route=>{
  assert.equal(route.request().method(),'POST');report.simulatedAnswers++;
  await route.fulfill({json:{answer:'Browser test response: evidence reviewed (simulated).',evidence_ids:[snapshot.evidence[0].evidence_id],investigation_id:'browser-test-only'}});
 });
 await context.route('**/api/assistant',route=>route.fulfill({status:400,json:{error:'Model requests disabled during browser acceptance.'}}));
 // Fail closed: no unmatched browser POST may reach the server during this audit.
 await context.route('**/*',route=>route.request().method()==='POST'
  ? (/\/chat(?:\?|$)/.test(route.request().url()) ? route.fallback() : route.abort('blockedbyclient'))
  : route.fallback());
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('.wafer-tile').first().waitFor();
 await header(page,'/');
 await page.locator('.app-nav a[href="/workspace"]').click();await page.waitForURL('**/workspace');
 await header(page,'/workspace');check('Replay homepage and shared three-page navigation');
 const response=await context.request.get(base+'/api/v1/runs/grp6-replay-demo?tester_id=grp6-replay');
 assert.equal(response.status(),200);snapshot=await response.json();
 assert.equal(snapshot.events.length,114);check('Persisted replay snapshot: 114 events');
 await page.getByLabel('Run ID',{exact:true}).fill('grp6-replay-demo');
 await page.getByLabel('Tester ID',{exact:true}).fill('grp6-replay');
 await page.locator('form.dc-connect button[type=submit]').click();
 await page.locator('.dc-event-list button').first().waitFor();
 assert.equal(await page.locator('.dc-event-list button').count(),snapshot.evidence.length);
 check('Load run and evidence selection');
 await page.locator('.dc-event-list button').first().click();
 await page.locator('.dc-ai-welcome button').first().click();
 assert.ok((await page.locator('.dc-composer textarea').inputValue()).length>0);
 assert.equal(report.simulatedAnswers,0);check('Suggested question fills draft without API request');
 await page.locator('.dc-composer button').click();
 await page.getByText('Browser test response: evidence reviewed (simulated).',{exact:true}).waitFor();
 await page.locator('#tab-predictions').click();
 assert.equal(await page.locator('#batch-panel tbody tr').count(),24);
 assert.equal(await page.locator('#tab-predictions').innerText(),'Temperature');
 await page.getByRole('heading',{name:'Temperature prediction vs actual',exact:true}).waitFor();
 const temperatureRow=page.locator('.dc-temperature-table tbody tr').first();
 assert.equal(await temperatureRow.locator('.dc-temperature-value').count(),2);
 const pair=await temperatureRow.locator('.dc-temperature-value').evaluateAll(nodes=>nodes.map(node=>Number(node.title.split(': ')[1])));
 const delta=Number((await temperatureRow.locator('.dc-temperature-difference').getAttribute('title')).split(': ')[1]);
 assert.ok(Math.abs(delta-(pair[0]-pair[1]))<1e-10);
 assert.ok(await temperatureRow.locator('.dc-temperature-value').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=24));
 check('Temperature tab emphasizes predicted/actual values with signed difference and source units');
 await page.locator('#tab-commands').click();await page.locator('#tab-evidence').click();
 assert.equal(await page.locator('.dc-chat-message.assistant').count(),1);
 check('Prediction/command tabs preserve investigation log; 24 prediction rows');
 await page.locator('.dc-event-list button').nth(1).click();
 assert.equal(await page.locator('.dc-chat-message.assistant').count(),0);
 await page.locator('.dc-event-list button').first().click();
 assert.equal(await page.locator('.dc-chat-message.assistant').count(),1);
 check('Switching incidents restores isolated conversations');
 await page.locator('.dc-search input').fill('no-matching-test-zz');
 assert.equal(await page.locator('.dc-event-list button').count(),0);
 assert.equal(await page.locator('.dc-chat-message.assistant').count(),1);
 await page.locator('.dc-search input').fill('');
 await page.locator('.dc-citations button').first().click();
 assert.equal(await page.locator('#tab-evidence').getAttribute('aria-selected'),'true');
 check('Search and citation retain completed conversation');
 await page.reload({waitUntil:'networkidle'});await page.locator('.dc-chat-message.assistant').waitFor();
 check('Reload restores run and conversation after fresh snapshot');
 await page.locator('.app-nav a[href="/"]').click();await page.waitForURL(base+'/');
 await page.locator('.wafer-tile').first().waitFor();assert.equal(await page.locator('.wafer-tile').count(),25);
 await page.locator('.wafer-tile').last().click();
 assert.match(await page.locator('.replay-detail').innerText(),/expected category not detected/i);
 await page.getByRole('tab',{name:'Model validation',exact:true}).click();
 assert.equal(await page.locator('.model-panel tbody tr').count(),6);
 await page.getByRole('tab',{name:'Limitations',exact:true}).click();await page.locator('.limitations-panel').waitFor();
 check('Replay navigation, W25 miss disclosure, validation and limitations');
 await page.locator('.app-nav a[href="/workspace"]').click();await page.waitForURL('**/workspace');
 await page.locator('.dc-chat-message.assistant').waitFor();check('Route round-trip retains conversation');
 await page.locator('#tab-evidence').focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('#tab-predictions').getAttribute('aria-selected'),'true');
 await page.keyboard.press('End');assert.equal(await page.locator('#tab-commands').getAttribute('aria-selected'),'true');
 await page.keyboard.press('Home');assert.equal(await page.locator('#tab-evidence').getAttribute('aria-selected'),'true');
 await page.getByRole('button',{name:'Disconnect event stream',exact:true}).click();
 assert.match(await page.locator('.dc-stream-status').innerText(),/Disconnected/);
 assert.equal(await page.locator('.dc-chat-message.assistant').count(),1);
 await page.locator('form.dc-connect button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('.dc-stream-status')?.textContent?.includes('Event stream connected'));
 check('Keyboard tabs and disconnect/reconnect retain evidence and conversation');
 await page.getByLabel('Run ID',{exact:true}).fill('missing-ui-audit-run');
 await page.locator('form.dc-connect button[type=submit]').click();await page.locator('.dc-error').waitFor();
 assert.equal(await page.locator('.dc-chat-message.assistant').count(),0);
 assert.equal(await page.locator('.dc-event-list button').count(),0);
 await page.getByLabel('Run ID',{exact:true}).fill('grp6-replay-demo');
 await page.locator('form.dc-connect button[type=submit]').click();await page.locator('.dc-chat-message.assistant').waitFor();
 check('Missing run clears stale scope; valid retry restores its conversation');
 await page.locator('.app-nav a[href="/sandbox"]').click();await page.waitForURL('**/sandbox');
 await header(page,'/sandbox');
 await page.locator('a.app-brand').click();await page.waitForURL(base+'/');check('Sandbox shared navigation and brand returns to replay homepage');
 await context.close();
 // Fresh browser context: screenshots contain real replay, no simulated answer.
 const visual=await browser.newContext({viewport:{width:1440,height:1000}});const screen=await visual.newPage();
 await visual.route('**/*',route=>route.request().method()==='POST'?route.abort('blockedbyclient'):route.fallback());
 screen.on('pageerror',error=>report.errors.push(error.message));
 await screen.goto(base+'/workspace',{waitUntil:'networkidle'});await screen.locator('form.dc-connect button[type=submit]').click();
 await screen.locator('.dc-event-list button').first().waitFor();
 for(const theme of ['light','dark']) {
  await screen.getByLabel('Color theme').selectOption(theme);
  await screen.screenshot({path:resolve(output,'dashboard-'+theme+'.png'),fullPage:true});
  assert.equal(await screen.locator('html').evaluate(el=>el.classList.contains('dark')),theme==='dark');
 }
 await screen.reload({waitUntil:'networkidle'});assert.equal(await screen.getByLabel('Color theme').inputValue(),'dark');
 check('Light/dark selection persists across reload');
 await screen.locator('#tab-predictions').click();
 await screen.screenshot({path:resolve(output,'temperature-desktop.png'),fullPage:true});
 await screen.locator('#tab-evidence').click();
 await screen.setViewportSize({width:390,height:844});
 await screen.screenshot({path:resolve(output,'dashboard-mobile.png'),fullPage:true});
 assert.ok(await screen.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Dashboard viewport overflow');
 await screen.locator('#tab-predictions').click();
 assert.ok(await screen.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Prediction table viewport overflow');
 await screen.screenshot({path:resolve(output,'temperature-mobile.png'),fullPage:true});
 check('390px layout and contained table scrolling');
 for (const selector of ['.dc-connect input','.dc-stream-status','.dc-composer textarea']) {
  const sizes=await screen.locator(selector).evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));
  assert.ok(sizes.length && sizes.every(size=>size >= (selector==='.dc-stream-status'?14:16)),selector+' too small');
 }
 assert.equal(await screen.getByText('Investigation available',{exact:true}).count(),0);
 check('Readable run fields and stream status; healthy investigation banner removed');
 await screen.setViewportSize({width:1440,height:1000});
 await screen.goto(base,{waitUntil:'networkidle'});await screen.locator('.wafer-scene').waitFor();
 await screen.waitForFunction(()=>document.querySelector('.wafer-scene')?.dataset.running==='true');
 await screen.getByRole('button',{name:'Pause wafer motion',exact:true}).click();
 assert.equal(await screen.locator('.wafer-scene').getAttribute('data-running'),'false');
 await screen.getByRole('button',{name:'Resume wafer motion',exact:true}).click();
 await screen.getByRole('button',{name:'Top view',exact:true}).click();
 assert.equal(await screen.locator('.wafer-scene').getAttribute('data-top-view'),'true');
 await screen.getByRole('button',{name:'Top view',exact:true}).click();
 await screen.emulateMedia({reducedMotion:'reduce'});
 await screen.getByRole('button',{name:'Animation disabled by reduced-motion preference'}).waitFor();
 assert.equal(await screen.locator('.wafer-scene').getAttribute('data-running'),'false');
 check('Wafer motion pause/resume, top view and reduced-motion preference');
 for (const width of [1440,390]) {
  await screen.setViewportSize({width,height:1000});
  const stats=await screen.locator('.stats strong').evaluateAll(nodes=>nodes.filter(n=>n.querySelector('small')).map(n=>{
   const r=document.createRange();r.selectNodeContents(n.firstChild);const value=r.getBoundingClientRect(),unit=n.querySelector('small').getBoundingClientRect();
   return {value:{right:value.right,bottom:value.bottom},unit:{left:unit.left,top:unit.top}};
  }));
  assert.ok(stats.length && stats.every(({value,unit})=>value.right<=unit.left+1 || value.bottom<=unit.top+1),'Replay stat value/unit overlap');
  assert.ok(await screen.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Replay overflow');
  for (const theme of ['light','dark']) {
   await screen.getByLabel('Color theme').selectOption(theme);
   await screen.screenshot({path:resolve(output,`replay-${width}-${theme}.png`),fullPage:true});
  }
 }
 check('Replay summary values and units do not overlap at desktop/mobile widths');
 await screen.goto(base+'/replay',{waitUntil:'networkidle'});await screen.locator('.wafer-tile').first().waitFor();
 assert.equal(await screen.locator('.wafer-tile').count(),25);check('Legacy /replay route remains functional');
 await visual.close();
 assert.equal(report.simulatedAnswers,1,'Only the explicitly mocked model submission ran');
 assert.deepEqual(report.errors,[],'Uncaught browser errors');report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report,null,2));
