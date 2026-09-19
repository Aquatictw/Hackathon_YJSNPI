// Browser acceptance for /replay and /sandbox against a running local preview.
// Every browser POST is intercepted: only a demo /api/assistant mock is fulfilled.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_EXECUTABLE reuse an installed browser runtime.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const origin = new URL(base);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && ['http:', 'https:'].includes(origin.protocol), 'Audit requires a loopback preview');
assert.equal(origin.pathname, '/', 'Base must be a preview origin');
const output = resolve(process.env.SECONDARY_UI_AUDIT_OUTPUT || resolve(root, '.wrangler/secondary-ui-audit'));
const report = {base, checkedAt: new Date().toISOString(), modelCalls: 0, forwardedPosts: 0, simulatedAnswers: 0,
  checks: [], failures: [], errors: [], findings: [], blockedRequests: [], assistantRequests: [], screenshots: [],
  limits: ['Local browser UI acceptance only; no live tester or model validation.', 'Assistant and clipboard success/failure are browser test doubles.', 'Import fixtures stay in browser memory and are not uploaded.']};
const sourcePaths = ['scripts/verify-secondary-ui.mjs', 'app/page.tsx', 'app/replay/page.tsx', 'app/sandbox/page.tsx', 'app/replay/replay.css', 'app/globals.css', 'components/app-header.tsx', 'components/app-header.css', 'components/wafer-scene.tsx', 'components/wafer-scene.css', 'lib/rtdi/replay.ts', 'lib/rtdi/fixtures.ts', 'lib/rtdi/edge-adapter.ts'];
async function hashes() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])));
}
await mkdir(output, {recursive: true});
report.sourceHashesBefore = await hashes();
let browser, page;
async function screenshot(name) {
  const path = resolve(output, name + '.png');
  await page.screenshot({path, fullPage: true}); report.screenshots.push(path);
}
async function check(name, action) {
  try {await action(); report.checks.push(name); console.log('PASS ' + name);}
  catch (error) {
    report.failures.push({name, error: error.stack}); console.error('FAIL ' + name + ': ' + error.message);
    try {await screenshot('failure-' + report.failures.length);} catch { /* Preserve the original failure. */ }
  }
}
async function until(predicate, message) {
  const deadline = Date.now() + 8000;
  do {if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50));} while (Date.now() < deadline);
  assert.fail(message);
}
async function noOverflow(label) {
  const size = await page.evaluate(() => ({viewport: innerWidth, width: document.documentElement.scrollWidth}));
  assert.ok(size.width <= size.viewport + 1, `${label}: document width ${size.width} exceeds viewport ${size.viewport}`);
}
async function chartReadability(label) {
  const metrics = await page.locator('.replay-plot > svg, .trend > svg').evaluateAll(charts => charts.map(svg => ({
    width: svg.getBoundingClientRect().width, container: svg.parentElement.clientWidth,
    overflow: getComputedStyle(svg.parentElement).overflowX,
    axes: [...svg.querySelectorAll('text')].map(text => parseFloat(getComputedStyle(text).fontSize) * Math.abs(text.getScreenCTM().a)),
  })));
  assert.ok(metrics.length, label + ' chart missing');
  for (const chart of metrics) {
    assert.ok(chart.width >= 649, label + ' chart scaled below its source width');
    assert.ok(chart.axes.length && chart.axes.every(size => size >= 13.9), label + ' rendered axes below 14px');
    assert.ok(['auto', 'scroll'].includes(chart.overflow), label + ' chart lacks contained scrolling');
  }
  report.chartMetrics ??= {}; report.chartMetrics[label] = metrics;
}
async function replayReady() {await page.locator('.replay-workspace[aria-busy="false"]').waitFor(); await page.locator('.wafer-tile').first().waitFor();}
const waferLabels = () => page.locator('.wafer-tile').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
const labelFor = wafer => `W${wafer.wafer}, yield ${(wafer.yield * 100).toFixed(1)}%, ${wafer.alerts.length} alerts`;
async function replayFingerprint() {
  return {source: await page.locator('.replay-source > span').innerText(), stats: await page.locator('.stats').innerText(),
    wafers: await waferLabels(), selected: await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label'),
    message: await page.locator('.original-message').allTextContents()};
}
async function sandboxFingerprint() {
  return {events: await page.locator('.inbox-item').allTextContents(), selected: await page.locator('.inbox-item[aria-pressed="true"]').allTextContents()};
}
async function clipboard(fail = false) {
  await page.evaluate(denied => {
    window.__secondaryClipboard = null;
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {async writeText(text) {
      if (denied) throw new DOMException('Audit clipboard denied', 'NotAllowedError');
      window.__secondaryClipboard = text;
    }}});
  }, fail);
}

try {
  const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
  // A single context-wide gate covers navigation, frames, popups and fetch. No
  // POST falls through to the network, including malformed/non-demo assistant calls.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (method === 'POST') {
      if (url.origin === origin.origin && url.pathname === '/api/assistant') {
        let body; try {body = request.postDataJSON();} catch { /* Rejected below. */ }
        if (body?.mode === 'demo' && typeof body.question === 'string' && body.question.trim() && body.context?.event?.event_id) {
          report.assistantRequests.push({mode: body.mode, question: body.question, eventId: body.context.event.event_id, history: body.history});
          report.simulatedAnswers++;
          return route.fulfill({json: {answer: 'Secondary UI audit: simulated rule-based answer. No model was called.', mode: 'demo', model: null}});
        }
      }
      report.blockedRequests.push({method, url: request.url(), reason: 'POST blocked'});
      return route.abort('blockedbyclient');
    }
    if (url.origin !== origin.origin || !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      report.blockedRequests.push({method, url: request.url(), reason: 'Nonlocal or mutating request blocked'});
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/api/config') return route.fulfill({json: {openai_configured: false, backend_connected: false, model: 'browser-test-double'}});
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(8000);
  context.on('page', opened => opened.on('pageerror', error => report.errors.push(error.message)));
  page.on('pageerror', error => report.errors.push(error.message));
  const summaryResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/replay/summary.json');
  await page.goto(base + '/replay', {waitUntil: 'networkidle'});
  const response = await summaryResponse; assert.equal(response.status(), 200);
  const summary = await response.json(); await replayReady();
  report.bundledSummarySha256 = createHash('sha256').update(await response.body()).digest('hex');
  report.bundledWaferCount = summary.wafers.length;
  await check('Replay bundled dataset renders all source wafers', async () => {assert.deepEqual(await waferLabels(), summary.wafers.map(labelFor));});
  await check('POST gate rejects an unmatched browser request before network delivery', async () => {
    const blocked = await page.evaluate(async () => {try {await fetch('/api/secondary-audit-block-probe', {method: 'POST'}); return false;} catch {return true;}});
    assert.equal(blocked, true); assert.ok(report.blockedRequests.some(request => request.url.endsWith('/api/secondary-audit-block-probe')));
  });
  for (const filter of ['alert', 'quiet', 'all']) {
    await check('Replay filter ' + filter + ' selects only matching source wafers', async () => {
      const expected = summary.wafers.filter(wafer => filter === 'all' || (filter === 'alert' ? wafer.alerts.length > 0 : !wafer.alerts.length));
      await page.getByLabel('Filter wafers').selectOption(filter);
      await until(async () => (await waferLabels()).length === expected.length, 'Filter count did not update');
      assert.deepEqual(await waferLabels(), expected.map(labelFor));
      if (expected.length) assert.ok(expected.map(labelFor).includes(await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label')));
    });
  }
  await check('Next wafer advances and wraps inside the active filter', async () => {
    await page.getByLabel('Filter wafers').selectOption('alert');
    const labels = summary.wafers.filter(wafer => wafer.alerts.length).map(labelFor); assert.ok(labels.length > 1);
    await page.locator('.wafer-tile').last().click(); await page.getByRole('button', {name: 'Next wafer', exact: true}).click();
    await until(async () => await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label') === labels[0], 'Next wafer did not wrap');
    await page.getByRole('button', {name: 'Next wafer', exact: true}).click();
    await until(async () => await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label') === labels[1], 'Next wafer did not advance');
  });
  await check('Replay clipboard success includes source and local evidence reference', async () => {
    await clipboard(); await page.getByRole('button', {name: 'Copy handoff', exact: true}).click();
    await page.getByText('Handoff copied to clipboard.', {exact: true}).waitFor();
    const text = await page.evaluate(() => window.__secondaryClipboard);
    assert.match(text, /Source: Bundled snapshot/); assert.match(text, /Local reference: wafer_id=/); assert.ok(text.includes('alerts[0]')); assert.match(text, /not a backend event ID/);
  });
  await check('Replay clipboard failure offers visible manual-copy fallback', async () => {
    await clipboard(true); await page.getByRole('button', {name: 'Copied', exact: true}).click();
    await page.getByRole('alert').filter({hasText: 'Clipboard unavailable.'}).waitFor();
    assert.equal(await page.evaluate(() => window.__secondaryClipboard), null);
  });
  await check('Replay raw disclosure exposes the selected source alert exactly', async () => {
    await page.getByText('View source alert fields', {exact: true}).click();
    const selected = await page.locator('.wafer-tile[aria-pressed="true"]').getAttribute('aria-label');
    const expected = summary.wafers.find(wafer => labelFor(wafer) === selected).alerts[0];
    const raw = JSON.parse(await page.locator('.raw-details[open] pre').innerText());
    // The renderer validates input and may strip unrelated source metadata.
    for (const [key, value] of Object.entries(raw)) assert.deepEqual(value, expected[key], key);
    assert.equal(raw.message, expected.message); await screenshot('replay-desktop-raw');
  });
  await check('Replay desktop has contained overflow and readable chart axes', async () => {
    await noOverflow('Replay desktop'); await chartReadability('Replay desktop');
  });
  const imported = structuredClone(summary);
  const alerted = structuredClone(summary.wafers.find(wafer => wafer.alerts.length));
  const quiet = structuredClone(summary.wafers.find(wafer => !wafer.alerts.length));
  assert.ok(alerted && quiet, 'Audit requires alert and quiet source examples');
  alerted.wafer = '901'; quiet.wafer = '902'; alerted.alerts[0].message = 'Browser-only QA import sentinel'; imported.wafers = [alerted, quiet];
  await check('Valid replay import replaces the dataset locally and resets filter/selection', async () => {
    await page.getByLabel('Import replay summary JSON').setInputFiles({name: 'secondary-valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported))});
    await page.getByText('Local import · secondary-valid.json', {exact: true}).first().waitFor(); await replayReady();
    assert.deepEqual(await waferLabels(), imported.wafers.map(labelFor));
    assert.equal(await page.getByLabel('Filter wafers').inputValue(), 'all');
    assert.equal(await page.locator('.original-message').innerText(), 'Browser-only QA import sentinel');
  });
  for (const [name, buffer, error] of [
    ['invalid-syntax', Buffer.from('{invalid'), 'Invalid summary.'],
    ['invalid-schema', Buffer.from(JSON.stringify({mode: 'replay', wafers: []})), 'Invalid summary.'],
    ['oversize', Buffer.alloc(5 * 1024 * 1024 + 1, ' '), 'File exceeds 5 MiB.'],
  ]) {
    await check('Replay ' + name + ' import preserves the previous dataset', async () => {
      const before = await replayFingerprint();
      await page.getByLabel('Import replay summary JSON').setInputFiles({name: name + '.json', mimeType: 'application/json', buffer});
      await page.locator('.inline-error').filter({hasText: error}).waitFor(); await replayReady();
      assert.deepEqual(await replayFingerprint(), before);
    });
  }
  await check('Reload snapshot replaces an imported dataset with the bundled source', async () => {
    await page.getByRole('button', {name: 'Reload snapshot', exact: true}).click();
    await page.locator('.replay-source').filter({hasText: 'Bundled snapshot'}).waitFor(); await replayReady();
    assert.deepEqual(await waferLabels(), summary.wafers.map(labelFor)); assert.equal(await page.locator('.inline-error').count(), 0);
  });
  await check('Browser reload restores the bundled source', async () => {await page.reload({waitUntil: 'networkidle'}); await replayReady(); assert.deepEqual(await waferLabels(), summary.wafers.map(labelFor));});
  await page.setViewportSize({width: 390, height: 844});
  for (const [tab, name] of [['Wafers & alerts', 'analysis'], ['Model validation', 'validation'], ['Limitations', 'limitations']]) {
    await check('Replay 390px ' + name + ' has no document overflow', async () => {
      await page.getByRole('tab', {name: tab, exact: true}).click();
      if (name === 'analysis') {await page.getByLabel('Filter wafers').selectOption('alert'); await page.getByText('View source alert fields', {exact: true}).click();}
      await noOverflow('Replay ' + name); if (name === 'analysis') await chartReadability('Replay mobile'); await screenshot('replay-mobile-' + name);
    });
  }

  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(base + '/sandbox', {waitUntil: 'networkidle'});
  const receive = page.locator('.receive-controls').getByRole('button', {name: 'Receive fixture', exact: true});
  await check('Sandbox duplicate before first batch shows a visible error', async () => {
    await page.getByLabel('Fixture scenario').selectOption('duplicate'); await receive.click();
    await page.getByText('Receive a batch before testing duplicate delivery.', {exact: true}).waitFor();
    assert.equal(await page.locator('.inbox-item').count(), 0);
  });
  let expectedEvents = 0;
  for (const [scenario, label] of [['anomaly', 'Mean shift'], ['normal', 'Normal observation'], ['missing', 'Insufficient data']]) {
    await check('Sandbox receives ' + scenario + ' fixture with scoped evidence and six predictions', async () => {
      await page.getByLabel('Fixture scenario').selectOption(scenario); await receive.click(); expectedEvents++;
      await until(async () => await page.locator('.inbox-item').count() === expectedEvents, 'Fixture did not add one event');
      assert.match(await page.locator('.event-badge').innerText(), new RegExp(label));
      assert.equal(await page.locator('.inline-error').count(), 0);
      await page.getByRole('tab', {name: 'Temperature predictions', exact: true}).click();
      assert.equal(await page.locator('.prediction-body tbody tr').count(), 6);
      await page.getByRole('tab', {name: 'Event analysis', exact: true}).click();
      if (scenario === 'missing') await page.getByText('No sequence supplied', {exact: true}).waitFor();
    });
  }
  await check('Sandbox duplicate delivery preserves unique events', async () => {
    const before = await sandboxFingerprint();
    await page.getByLabel('Fixture scenario').selectOption('duplicate'); await receive.click();
    await page.getByText('Ignored 1 duplicate events; no duplicate incidents created.', {exact: true}).waitFor();
    assert.deepEqual(await sandboxFingerprint(), before);
  });
  await page.getByRole('tab', {name: 'Message JSON', exact: true}).click();
  let jsonFixture;
  await check('Sandbox valid JSON is parsed and received through the visible receiver', async () => {
    await page.getByRole('button', {name: 'Load fixture', exact: true}).click();
    jsonFixture = JSON.parse(await page.getByRole('textbox', {name: 'Message JSON', exact: true}).inputValue());
    assert.equal(jsonFixture.schema_version, '0.1-draft');
    await page.getByRole('button', {name: 'Receive JSON', exact: true}).click(); expectedEvents++;
    await until(async () => await page.locator('.inbox-item').count() === expectedEvents, 'JSON batch was not received');
  });
  for (const [name, json, message] of [['syntax', '{invalid', 'Invalid JSON syntax.'], ['schema', '{}', null]]) {
    await check('Sandbox invalid JSON ' + name + ' preserves the event workspace', async () => {
      const before = await sandboxFingerprint();
      await page.getByRole('textbox', {name: 'Message JSON', exact: true}).fill(json); await page.getByRole('button', {name: 'Receive JSON', exact: true}).click();
      const error = page.locator('.inline-error');
      if (message) await error.filter({hasText: message}).waitFor();
      else {
        await until(async () => await error.isVisible() && (await error.innerText()).trim().length > 0 && !(await error.innerText()).includes('Invalid JSON syntax.'), 'Schema rejection did not replace the syntax error');
        const text = await error.innerText();
        if (/[一-鿿]/u.test(text)) report.findings.push({severity: 'nonblocking', path: 'lib/rtdi/edge-adapter.ts:9', issue: 'Schema rejection uses Chinese text in the English sandbox UI.', observed: text});
      }
      assert.deepEqual(await sandboxFingerprint(), before);
    });
  }
  await check('Sandbox raw disclosure matches the received event ID', async () => {
    await page.getByText('View source event fields', {exact: true}).click();
    const raw = JSON.parse(await page.locator('.raw-details[open] pre').innerText());
    assert.deepEqual(raw.event, jsonFixture.records.find(record => record.type === 'event'));
  });
  await check('Sandbox clipboard success copies the selected source', async () => {
    await clipboard(); await page.getByRole('button', {name: 'Copy source', exact: true}).click();
    await page.getByRole('button', {name: 'Copied', exact: true}).waitFor();
    const raw = JSON.parse(await page.evaluate(() => window.__secondaryClipboard));
    assert.equal(raw.event.event_id, jsonFixture.records.find(record => record.type === 'event').event_id);
  });
  await check('Sandbox clipboard failure reports a manual-copy fallback', async () => {
    await clipboard(true); await page.getByRole('button', {name: 'Copied', exact: true}).click();
    await page.getByText('Clipboard unavailable. Select the source text to copy manually.', {exact: true}).waitFor();
  });
  await page.getByRole('tab', {name: 'Event analysis', exact: true}).click();
  await check('Sandbox question templates fill drafts without submitting', async () => {
    assert.equal(await page.getByLabel('Response mode').inputValue(), 'demo');
    const before = report.simulatedAnswers, blocked = report.blockedRequests.length;
    const suggestions = page.locator('.suggestions button'), count = await suggestions.count(); assert.ok(count > 0);
    for (let i = 0; i < count; i++) {
      const text = (await suggestions.nth(i).innerText()).trim(); await suggestions.nth(i).click();
      assert.equal(await page.getByLabel('Investigation question').inputValue(), text);
    }
    assert.equal(report.simulatedAnswers, before); assert.equal(report.blockedRequests.length, blocked);
  });
  await check('Sandbox demo requires explicit submit and renders a browser-mocked answer', async () => {
    const before = report.simulatedAnswers;
    await page.getByLabel('Investigation question').fill('Browser QA explicit submission');
    await page.getByRole('button', {name: 'Submit question', exact: true}).click();
    await page.getByText('Secondary UI audit: simulated rule-based answer. No model was called.', {exact: true}).waitFor();
    assert.equal(report.simulatedAnswers, before + 1); assert.equal(report.assistantRequests.at(-1).mode, 'demo');
    assert.equal(report.assistantRequests.at(-1).eventId, jsonFixture.records.find(record => record.type === 'event').event_id);
    await screenshot('sandbox-desktop-mocked-demo');
  });
  await check('Sandbox desktop has contained overflow and readable chart axes', async () => {
    await noOverflow('Sandbox desktop'); await chartReadability('Sandbox desktop');
  });
  await page.setViewportSize({width: 390, height: 844});
  for (const [tab, name] of [['Event analysis', 'analysis'], ['Temperature predictions', 'predictions'], ['Message JSON', 'json']]) {
    await check('Sandbox 390px ' + name + ' has no document overflow', async () => {
      await page.getByRole('tab', {name: tab, exact: true}).click();
      if (name === 'json') {const details = page.locator('.raw-details'); if (!await details.getAttribute('open').then(value => value !== null)) await details.locator('summary').click();}
      await noOverflow('Sandbox ' + name); if (name === 'analysis') await chartReadability('Sandbox mobile'); await screenshot('sandbox-mobile-' + name);
    });
  }
  await check('Sandbox reset clears events, conversation, errors and the question draft', async () => {
    await page.getByRole('button', {name: 'Reset workspace', exact: true}).click();
    await page.getByText('Local workspace cleared. Tester data is unchanged.', {exact: true}).waitFor();
    assert.equal(await page.locator('.inbox-item').count(), 0); assert.equal(await page.locator('.chat-message').count(), 0);
    assert.equal(await page.locator('.inline-error').count(), 0); assert.equal(await page.getByLabel('Investigation question').inputValue(), '');
    assert.equal(await page.getByRole('button', {name: 'Submit question', exact: true}).isDisabled(), true);
  });
  await check('No unexpected POST attempts or uncaught browser errors', async () => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.blockedRequests.filter(request => !request.url.endsWith('/api/secondary-audit-block-probe')), []);
    assert.equal(report.simulatedAnswers, 1, 'Only explicit demo submission should reach the mock');
  });
  await context.close();
} catch (error) {report.failures.push({name: 'Audit setup or dependent flow', error: error.stack});}
finally {
  report.sourceHashesAfter = await hashes();
  report.sourceChangedDuringAudit = Object.keys(report.sourceHashesBefore).filter(path => report.sourceHashesBefore[path] !== report.sourceHashesAfter[path]);
  report.passed = report.failures.length === 0 && report.sourceChangedDuringAudit.length === 0;
  report.checkCount = report.checks.length + report.failures.length;
  if (!report.passed) process.exitCode = 1;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
}
console.log(JSON.stringify(report, null, 2));
