// Isolated loopback UI checks. No mutation requests or external traffic.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

const base = new URL(process.argv[2] || 'http://localhost:5173').origin;
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {})});
const checks = [];
const measurements = [];
const failures = [];
const summary = JSON.parse(await readFile(new URL('../public/replay/summary.json', import.meta.url), 'utf8'));
try {
  for (const width of [1770, 1440, 390, 320]) {
    const context = await browser.newContext({viewport:{width, height:900}, reducedMotion:'reduce'});
    await context.addInitScript(summary => {
      sessionStorage.setItem('rtdi.source-session.v1', JSON.stringify({version:1, mode:'summary', replay:{data:summary, filename:'guide-test.json', selection:{waferId:String(summary.wafers.find(wafer => wafer.alerts.length).wafer), alertIndex:0, filter:'all', tab:'analysis', detailOpen:true}}}));
    }, summary);
    await context.route('**/*', route => {
      const request = route.request();
      return ['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).origin === base ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const card = page.locator('.rtdi-tour-card');
    const chooser = card.locator('.language-selector select');
    async function settle() {
      await page.evaluate(() => new Promise(resolve => {
        let previous = '', stable = 0, frames = 0;
        const sample = () => {
          const next = JSON.stringify(['.rtdi-tour-card','.rtdi-tour-spotlight','.alert-selector'].map(selector => document.querySelector(selector)?.getBoundingClientRect().toJSON()));
          stable = next === previous ? stable + 1 : 0;
          previous = next;
          if (stable >= 6 || ++frames >= 60) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }));
    }
    async function language(value, step) {
      await chooser.selectOption(value);
      await page.waitForFunction(value => document.documentElement.lang === value, value);
      await settle();
      assert.equal(await card.getAttribute('data-step'), step);
      assert.equal(await chooser.inputValue(), value);
      const title = await card.locator('h2').innerText();
      assert.equal(/[\u3400-\u9fff]/.test(title), value === 'zh-TW');
      const bounds = await card.evaluate(el => {
        const r = el.getBoundingClientRect(), s = el.querySelector('select').getBoundingClientRect();
        return {fits:r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, chooserFits:s.left >= r.left && s.right <= r.right && s.top >= r.top && s.bottom <= r.bottom, touchHeight:s.height, overflow:el.scrollWidth > el.clientWidth + 1};
      });
      assert.ok(bounds.fits && bounds.chooserFits && !bounds.overflow, JSON.stringify(bounds));
      assert.ok(bounds.touchHeight >= 44);
      await chooser.focus();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab');
        assert.ok(await card.evaluate(el => el.contains(document.activeElement)), 'Focus escaped tour');
      }
    }
    async function geometry(label) {
      await settle();
      const result = await page.evaluate(() => {
        const target = document.querySelector('.alert-selector');
        const spotlight = document.querySelector('.rtdi-tour-spotlight');
        const r = target.getBoundingClientRect(), s = spotlight.getBoundingClientRect();
        const css = getComputedStyle(target);
        const buttons = [...target.querySelectorAll('button')].map(el => el.getBoundingClientRect().toJSON());
        const top = Math.min(...buttons.map(r => r.top)), bottom = Math.max(...buttons.map(r => r.bottom));
        const expected = {left:Math.max(0,r.left + parseFloat(css.paddingLeft) - 6), right:Math.min(innerWidth,r.right - parseFloat(css.paddingRight) + 6), top:Math.max(0,top - 6), bottom:Math.min(innerHeight,bottom + 6)};
        const errors = Object.fromEntries(Object.entries(expected).map(([key,value]) => [key,s[key]-value]));
        return {row:r.toJSON(), spotlight:s.toJSON(), buttons, padding:css.padding, expected, errors, centerYError:(s.top+s.bottom-top-bottom)/2};
      });
      measurements.push({width,label,...result});
      console.log('BOUNDS '+JSON.stringify({width,label,...result}));
      if (Object.values(result.errors).some(error => Math.abs(error) > 1)) failures.push({width,label,errors:result.errors});
    }
    try {
      await page.goto(base + '/replay');
      await page.locator('.app-guide:not(:disabled)').waitFor();
      await page.locator('.alert-selector button').first().waitFor();
      await page.locator('[data-step=chapters]').waitFor();
      await language('zh-TW','chapters');
      await language('en','chapters');
      checks.push(`${width}px welcome language, touch target, fit and focus trap`);
      await card.locator('.rtdi-tour-chapters a[href="/replay"]').click();
      for (let i=0; i<20 && await card.getAttribute('data-step') !== 'alerts'; i++) await card.locator('.rtdi-tour-next').click();
      await page.locator('[data-step=alerts]').waitFor();
      await page.locator('.rtdi-tour-spotlight').waitFor();
      await language('en','alerts');
      await geometry('English alert step');
      await language('zh-TW','alerts');
      await geometry('Chinese alert step');
      await page.evaluate(() => window.scrollBy(0,-40));
      await geometry('After scroll');
      await page.setViewportSize({width:width+20,height:900});
      await geometry('After resize');
      checks.push(`${width}px active step language, touch target, fit and focus trap`);
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({checks,failures}));
  assert.deepEqual(failures, [], 'Alert highlight must enclose the full usable row with symmetric 6px padding');
  console.log(`PASS ${checks.length} language/layout checks and ${measurements.length} bounding-box checks`);
} finally { await browser.close(); }
