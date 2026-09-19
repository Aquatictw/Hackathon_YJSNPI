// Browser-only checks against an existing loopback preview. No UI source edits.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_EXECUTABLE reuse the cached runtime.
// node frontend/scripts/verify-replay-limitations-ui.mjs [http://localhost:5173]
// Screenshots and JSON results go to a fresh OS temporary directory.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const base = new URL(process.argv[2] || 'http://localhost:5173');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Loopback preview required');
assert.ok(['http:', 'https:'].includes(base.protocol));
assert.equal(base.pathname, '/');
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(join(tmpdir(), 'replay-limitations-ui-'));
const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE} : {})});
const report = {base: base.origin, output, cases: [], tour: [], blocked: [], errors: [], forwardedPosts: 0};
const labels = {
  en: {title: 'Dataset limitations', limitations: 'Limitations', live: 'Live integration — source report', empty: 'None supplied.', tourTitle: 'Read the dataset source fields', tourBody: 'This panel shows the report’s limitations and live_integration value exactly as supplied.'},
  'zh-TW': {title: '資料集限制', limitations: '限制', live: '即時整合 — 來源報告', empty: '未提供。', tourTitle: '閱讀資料集來源欄位', tourBody: '此面板依原文顯示報告中的限制與 live_integration 值。'},
};
const sourceValues = [
  '  Source line 1: <b>literal</b> & "quoted" {0}\n第二行：來源原文，保持  雙空格。\n\nLast line.  ',
  'Reference: ' + 'abcdefgh0123456789'.repeat(10) + '\nTab\tpreserved; “Unicode” — ✓',
].map(value => value.replaceAll('\\n', '\n').replaceAll('\\t', '\t'));
const integration = ('  source=offline & <ready>false</ready> {0}\n原文狀態：待確認\n' + 'report-id-'.repeat(14) + '  ').replaceAll('\\n', '\n');
const fixture = empty => ({mode: 'replay', live_integration: integration, wafers: [{wafer: 'fixture-901', devices: 2, yield: 0.5, expected: 'normal', expected_first_device: null, alerts: []}], validation: {metrics: {}}, limitations: empty ? [] : sourceValues});
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function geometry(panel) {
  return panel.evaluate(element => {
    const content = element.querySelector('.limitations-content'), headings = [...content.querySelectorAll('h3')];
    const css = node => { const s = getComputedStyle(node); return {padding: s.padding, marginTop: s.marginTop, marginBottom: s.marginBottom, fontSize: s.fontSize, lineHeight: s.lineHeight, whiteSpace: s.whiteSpace, overflowWrap: s.overflowWrap, minHeight: s.minHeight}; };
    const box = element.getBoundingClientRect();
    const overflow = [...element.querySelectorAll('*')].filter(node => { const r = node.getBoundingClientRect(); return node.scrollWidth > node.clientWidth + 1 || r.left < box.left - 1 || r.right > box.right + 1; }).map(node => ({tag: node.tagName, className: node.className, width: node.clientWidth, scroll: node.scrollWidth}));
    return {panel: css(element), title: css(element.querySelector('h2')), content: css(content), headings: headings.map(css), items: [...content.querySelectorAll('li')].map(css), integration: css(content.querySelector('.replay-integration-value')), width: box.width, height: box.height, bottomGap: box.bottom - content.getBoundingClientRect().bottom, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, overflow};
  });
}

try {
  for (const locale of ['en', 'zh-TW']) for (const width of [1440, 320]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce', colorScheme: theme, serviceWorkers: 'block', storageState: {cookies: [], origins: [{origin: base.origin, localStorage: [
      {name: 'rtdi.locale', value: locale}, {name: 'theme', value: theme}, {name: 'rtdi-guided-tour-visit-v1', value: JSON.stringify({version: 1, status: 'dismissed'})},
    ]}]}});
    await context.addCookies([{name: 'rtdi.locale', value: locale, url: base.origin}]);
    await context.route('**/*', route => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method())) { report.blocked.push({method: request.method(), url: request.url()}); return route.abort(); }
      if (new URL(request.url()).origin !== base.origin) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push({locale, width, theme, error: error.message}));
    try {
      await page.goto(base.href);
      await page.locator('.app-guide:not(:disabled)').waitFor();
      await page.locator('.wafer-tiles button').first().waitFor();
      await page.waitForFunction(({locale, theme}) => document.documentElement.lang === locale && document.documentElement.classList.contains(theme), {locale, theme});
      for (const empty of [false, true]) {
        const name = [locale, width, theme, empty ? 'empty' : 'multiline'].join('-');
        const result = {name, passed: false};
        try {
          const data = fixture(empty);
          await page.locator('input[type=file]').setInputFiles({name: name + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data))});
          await page.waitForFunction(filename => document.querySelector('.replay-source')?.textContent.includes(filename), name + '.json');
          await page.getByRole('tab', {name: labels[locale].limitations, exact: true}).click();
          const panel = page.locator('.limitations-panel');
          await panel.waitFor({state: 'visible'});
          await settle(page);
          assert.equal(await panel.locator('h2').textContent(), labels[locale].title);
          assert.deepEqual(await panel.locator('h3').allTextContents(), [labels[locale].limitations, labels[locale].live]);
          assert.deepEqual(await panel.locator('li').allTextContents(), data.limitations, 'Source limitations must remain exact textContent');
          assert.equal(await panel.locator('.replay-integration-value').textContent(), integration, 'Source integration must not be translated, interpolated or trimmed');
          const expected = labels[locale].title + labels[locale].limitations + (empty ? labels[locale].empty : sourceValues.join('')) + labels[locale].live + integration;
          assert.equal(await panel.textContent(), expected, 'Panel must contain only requested source fields and headings');
          assert.equal(await panel.locator('.limit-callout,.source-status,.panel-header,.mini-label,svg,button,a,code,b,ready').count(), 0, 'Old elements and parsed source markup must be absent');
          assert.equal(await panel.locator('.limitations-content > p:not(.replay-integration-value)').count(), empty ? 1 : 0);
          if (empty) assert.equal(await panel.locator('.limitations-content > p').first().textContent(), labels[locale].empty);
          result.geometry = await geometry(panel);
          const g = result.geometry;
          assert.ok(g.documentWidth <= width + 1, 'Document horizontal overflow: ' + JSON.stringify(g));
          assert.deepEqual(g.overflow, [], 'Panel descendant overflow');
          assert.equal(g.panel.padding, '18px 20px');
          assert.equal(g.panel.minHeight, '0px');
          assert.equal(g.content.padding, '0px');
          assert.equal(g.title.marginBottom, '12px');
          assert.equal(g.headings[0].marginTop, '0px');
          assert.equal(g.headings[1].marginTop, '12px');
          assert.ok(g.headings.every(h => h.marginBottom === '4px'));
          assert.equal(g.integration.whiteSpace, 'pre-wrap');
          assert.equal(g.integration.fontSize, '14px');
          assert.ok(g.items.every(item => item.whiteSpace === 'pre-wrap' && item.overflowWrap === 'anywhere'));
          assert.ok(g.bottomGap >= 18 && g.bottomGap <= 21, 'Unexpected trailing panel whitespace');
          result.screenshot = join(output, name + '.png');
          await panel.screenshot({path: result.screenshot, animations: 'disabled'});
          result.passed = true;
          console.log('PASS ' + name + ' ' + JSON.stringify({height: g.height, padding: g.panel.padding, bottomGap: g.bottomGap}));
        } catch (error) { result.error = error.message; console.error('FAIL ' + name + ': ' + error.message); await page.screenshot({path: join(output, name + '-failure.png')}).catch(() => {}); }
        report.cases.push(result);
      }
      if (width === 1440 && theme === 'light') {
        const tour = {locale, passed: false};
        try {
          await page.evaluate(() => sessionStorage.setItem('rtdi-guided-tour-v1', JSON.stringify({version: 1, id: 'limitations', expires: Date.now() + 60000})));
          await page.reload();
          const card = page.locator('.rtdi-tour-card[data-step=limitations]');
          await card.waitFor();
          assert.equal(await card.locator('h2').textContent(), labels[locale].tourTitle);
          assert.ok((await card.textContent()).includes(labels[locale].tourBody));
          await page.locator('.limitations-panel').waitFor({state: 'visible'});
          tour.passed = true;
          console.log('PASS tour ' + locale);
        } catch (error) { tour.error = error.message; console.error('FAIL tour ' + locale + ': ' + error.message); }
        report.tour.push(tour);
      }
    } catch (error) { report.cases.push({name: [locale, width, theme, 'setup'].join('-'), passed: false, error: error.message}); console.error(error.message); }
    finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({output, cases: report.cases.length, passed: report.cases.filter(c => c.passed).length, tours: report.tour, blocked: report.blocked, errors: report.errors}));
assert.equal(report.cases.length, 16);
assert.ok(report.cases.every(result => result.passed), 'One or more browser checks failed; inspect report.json');
assert.equal(report.tour.length, 2);
assert.ok(report.tour.every(result => result.passed));
assert.deepEqual(report.blocked, [], 'No POST or other mutation attempt is permitted');
assert.deepEqual(report.errors, [], 'Unexpected browser errors');
