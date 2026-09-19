// Local locale smoke: every POST is mocked or blocked. No paid requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const base=process.argv[2] || 'http://localhost:5173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.addInitScript(()=>localStorage.setItem('rtdi-guided-tour-visit-v1',JSON.stringify({version:1,status:'dismissed'})));
const requests=[];
await context.route('**/*',route=>{
 const r=route.request();
 if(r.method()==='POST' && new URL(r.url()).pathname==='/api/assistant'){requests.push(r.postDataJSON());return route.fulfill({json:{answer:'Saved answer EV-001 42.35',mode:'demo',model:null,knowledge_sources:[]}});}
 if(!['GET','HEAD'].includes(r.method()) || !r.url().startsWith(base))return route.abort();
 return route.continue();
});
const page=await context.newPage();page.setDefaultTimeout(10000);
const checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function ready(){await page.locator('.app-guide:not(:disabled)').waitFor();}
async function locale(value){await page.locator('.language-selector select').selectOption(value);await page.waitForFunction(v=>document.documentElement.lang===v,value);}
try{
 await page.goto(base);await ready();await page.locator('.wafer-tile[aria-pressed="true"]').waitFor();
 await check('Replay selection and collapsed detail survive language changes',async()=>{
  const tile=page.locator('.wafer-tile[aria-pressed="true"]');const label=await tile.getAttribute('aria-label');
  await tile.click();assert.equal(await tile.getAttribute('aria-expanded'),'false');
  await locale('zh-TW');assert.equal(await tile.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('#replay-wafer-detail').isVisible(),false);
  await locale('en');assert.equal(await tile.getAttribute('aria-label'),label);
  await tile.click();assert.equal(await tile.getAttribute('aria-expanded'),'true');
 });
 await check('Language persists after reload and tour details translate',async()=>{
  await locale('zh-TW');await page.reload();await ready();await page.waitForFunction(()=>document.documentElement.lang==='zh-TW');
  await page.locator('.app-guide').click();assert.match(await page.locator('#rtdi-tour-title').innerText(),/[\u3400-\u9fff]/);
  await page.locator('.rtdi-tour-next').click();assert.match(await page.locator('.rtdi-tour-detail').innerText(),/語言.*主題/);await page.keyboard.press('Escape');
 });
 await page.goto(base+'/sandbox');await ready();
 await check('Sandbox drafts and raw evidence survive switching; request follows language',async()=>{
  await page.locator('.receive-controls button').click();await page.locator('.composer textarea').fill('Draft EV-001');
  const source=await page.locator('.event-message').innerText();const selected=await page.locator('.inbox-item.selected').innerText();
  await locale('en');assert.equal(await page.locator('.composer textarea').inputValue(),'Draft EV-001');assert.equal(await page.locator('.event-message').innerText(),source);
  await page.getByRole('tab',{name:'Message JSON',exact:true}).click();await page.locator('#batch-json').fill('{"source":"unchanged"}');
  await locale('zh-TW');assert.equal(await page.locator('#batch-json').inputValue(),'{"source":"unchanged"}');assert.equal(await page.locator('.inbox-item.selected').innerText(),selected);
  await page.locator('.composer button[type=submit]').click();await page.getByText('Saved answer EV-001 42.35',{exact:true}).waitFor();assert.equal(requests.at(-1).language,'zh-TW');
  await locale('en');assert.equal(await page.getByText('Saved answer EV-001 42.35',{exact:true}).count(),1);
 });
 await page.goto(base+'/workspace');await ready();
 await check('Workspace translation and global language remain available',async()=>{
  await locale('zh-TW');assert.equal(await page.locator('.language-selector select').inputValue(),'zh-TW');
  assert.match(await page.locator('main').innerText(),/半導體/);
  await locale('en');assert.match(await page.locator('main').innerText(),/Semiconductor Q&A/);
 });
 console.log(JSON.stringify({passed:checks.length,checks,mockedPosts:requests.length,realPosts:0}));
}finally{await browser.close();}
