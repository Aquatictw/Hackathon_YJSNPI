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
 await page.locator('.dc-nav a[href="/replay"]').click();await page.waitForURL('**/replay');
 await page.locator('.wafer-tile').first().waitFor();assert.equal(await page.locator('.wafer-tile').count(),25);
 await page.locator('.wafer-tile').last().click();
 assert.match(await page.locator('.replay-detail').innerText(),/expected category not detected/i);
 await page.getByRole('tab',{name:'Model validation',exact:true}).click();
 assert.equal(await page.locator('.model-panel tbody tr').count(),6);
 await page.getByRole('tab',{name:'Limitations',exact:true}).click();await page.locator('.limitations-panel').waitFor();
 check('Replay navigation, W25 miss disclosure, validation and limitations');
 await page.locator('.return-link').click();await page.waitForURL(base+'/');
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
 await page.locator('.dc-nav a[href="/sandbox"]').click();await page.waitForURL('**/sandbox');
 await page.locator('a.brand').click();await page.waitForURL(base+'/');check('Sandbox route and return');
 await context.close();
 // Fresh browser context: screenshots contain real replay, no simulated answer.
 const visual=await browser.newContext({viewport:{width:1440,height:1000}});const screen=await visual.newPage();
 await visual.route('**/*',route=>route.request().method()==='POST'?route.abort('blockedbyclient'):route.fallback());
 screen.on('pageerror',error=>report.errors.push(error.message));
 await screen.goto(base,{waitUntil:'networkidle'});await screen.locator('form.dc-connect button[type=submit]').click();
 await screen.locator('.dc-event-list button').first().waitFor();
 for(const theme of ['light','dark']) {
  await screen.getByLabel('Color theme').selectOption(theme);
  await screen.screenshot({path:resolve(output,'dashboard-'+theme+'.png'),fullPage:true});
  assert.equal(await screen.locator('html').evaluate(el=>el.classList.contains('dark')),theme==='dark');
 }
 await screen.reload({waitUntil:'networkidle'});assert.equal(await screen.getByLabel('Color theme').inputValue(),'dark');
 check('Light/dark selection persists across reload');
 await screen.setViewportSize({width:390,height:844});
 await screen.screenshot({path:resolve(output,'dashboard-mobile.png'),fullPage:true});
 assert.ok(await screen.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Dashboard viewport overflow');
 await screen.locator('#tab-predictions').click();
 assert.ok(await screen.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Prediction table viewport overflow');
 check('390px layout and contained table scrolling');await visual.close();
 assert.equal(report.simulatedAnswers,1,'Only the explicitly mocked model submission ran');
 assert.deepEqual(report.errors,[],'Uncaught browser errors');report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report,null,2));
