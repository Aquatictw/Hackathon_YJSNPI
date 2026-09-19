// Run against an existing local preview; writes no fixtures or audit artifacts.
// node frontend/scripts/verify-source-navigation-ui.mjs [http://localhost:5173] [--locale=en|zh-TW]
// PLAYWRIGHT_MODULE / PLAYWRIGHT_EXECUTABLE match verify-locale-navigation-ui.mjs.
// All POSTs and nonlocal requests are blocked. Backend snapshot/SSE are test doubles.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const args = process.argv.slice(2);
const base = new URL(args.find(arg => !arg.startsWith('--')) || 'http://localhost:5173');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Loopback preview required');
assert.ok(['http:', 'https:'].includes(base.protocol));
assert.equal(base.pathname, '/', 'Use the preview origin without a route');
const onlyLocale = args.find(arg => arg.startsWith('--locale='))?.slice(9);
assert.ok(!onlyLocale || ['en', 'zh-TW'].includes(onlyLocale), 'Unknown --locale');
const sessionKey = 'rtdi.source-session.v1';
const bundled = JSON.parse(await readFile(new URL('../public/replay/summary.json', import.meta.url), 'utf8'));
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE} : {})});
const report = {base: base.origin, checkedAt: new Date().toISOString(), checks: [], blockedRequests: [], backendRequests: [], errors: [], modelCalls: 0, forwardedPosts: 0,
  limits: 'Local browser regression only. Snapshot/SSE are test doubles; no backend persistence, live tester, deployment or model acceptance.'};
const labels = {
  en: {nav: ['Replay analysis', 'Run workspace', 'Sandbox'], load: 'Load backend run', retained: /previous dataset is retained/i},
  'zh-TW': {nav: ['重播分析', '批次工作區', '沙盒'], load: '載入後端批次', retained: /先前資料集.*保留/},
};

async function check(name, action) {
  try {
    await action(); report.checks.push({name, passed: true}); console.log('PASS ' + name); return true;
  } catch (error) {
    report.checks.push({name, passed: false, error: error.message}); console.error('FAIL ' + name + ': ' + error.message); return false;
  }
}

function fixture(locale) {
  const token = randomUUID().slice(0, 8), data = structuredClone(bundled);
  const alerted = bundled.wafers.find(wafer => wafer.alerts.length), quiet = bundled.wafers.find(wafer => !wafer.alerts.length);
  assert.ok(alerted && quiet, 'Bundled fixture needs alert and quiet wafers');
  // Nonsequential IDs and a nonfirst alert detect accidental index/default restoration.
  data.wafers = [structuredClone(alerted), structuredClone(quiet), structuredClone(alerted)];
  data.wafers.forEach((wafer, index) => {wafer.wafer = ['901', '947', '983'][index];});
  data.wafers[0].alerts = [structuredClone(alerted.alerts[0])];
  data.wafers[2].alerts = [structuredClone(alerted.alerts[0]), structuredClone(alerted.alerts.at(-1))];
  data.wafers.forEach(wafer => wafer.alerts.forEach((alert, index) => {
    alert.message = 'Source navigation ' + token + ': W' + wafer.wafer + ' alert ' + (index + 1);
    alert.test = 'source-navigation-' + token + '-' + wafer.wafer + '-' + (index + 1);
  }));
  data.limitations = ['Browser fixture ' + token + ': historical summary only.', ...data.limitations];
  return {data, filename: 'source-navigation-' + locale + '-' + token + '-modified-summary.json',
    selection: {waferId: '983', alertIndex: 1, filter: 'alert', tab: 'analysis', detailOpen: true}};
}

// Same normalized snapshot shape as verify-workspace-ui and ui-lifecycle fixtures.
function backendFixture() {
  const event = {event_id: 'source-navigation-backend-event', type: 'evidence', source_mode: 'replay',
    run_id: 'source-navigation-backend', tester_id: 'source-navigation-tester', timestamp: '2026-09-19T00:00:00Z',
    wafer_id: 'backend-only', evidence_id: 'source-navigation-backend-evidence', incident_id: 'source-navigation-backend-incident',
    kind: 'mean_drift_up', severity: 'warning', message: 'Backend snapshot sentinel: explicit source switch only.',
    current_value: 2, baseline: 1, score: 3, series: [1, 1.5, 2], suggestion: 'Browser fixture; no model request.'};
  return {run: {run_id: event.run_id, tester_id: event.tester_id, edge_id: 'browser-fixture', mode: 'replay',
    lot_id: null, wafer_id: event.wafer_id, data_quality: 'partial', last_event_at: event.timestamp},
    events: [event], evidence: [event], incidents: [], commands: []};
}

async function isolated(locale) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', serviceWorkers: 'block',
    storageState: {cookies: [], origins: [{origin: base.origin, localStorage: [
      {name: 'rtdi.locale', value: locale}, {name: 'rtdi.response-language', value: locale},
      {name: 'rtdi-guided-tour-visit-v1', value: JSON.stringify({version: 1, status: 'dismissed'})},
    ]}]}});
  const state = {context, locale, backendAllowed: false, unexpectedBackend: [], requests: [], snapshot: backendFixture()};
  await context.addInitScript(() => {window.__sourceNavigationDocument = Math.random().toString(36);});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method()) || url.origin !== base.origin) {
      report.blockedRequests.push({locale, method: request.method(), url: request.url()});
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/api/config') return route.fulfill({json: {openai_configured: false, backend_connected: true, model: 'browser-test-double'}});
    // Count attempts even when blocked: a quiet server does not prove source isolation.
    if (/^\/api\/(?:v1\/)?runs(?:\/|$)/.test(url.pathname) || request.resourceType() === 'eventsource') {
      const entry = {locale, path: url.pathname, search: url.search, type: request.resourceType(), allowed: state.backendAllowed};
      state.requests.push(entry); report.backendRequests.push(entry);
      if (!state.backendAllowed) {state.unexpectedBackend.push(entry); return route.abort('blockedbyclient');}
      const path = '/api/v1/runs/' + state.snapshot.run.run_id;
      if (url.searchParams.get('tester_id') !== state.snapshot.run.tester_id) return route.fulfill({status: 409, json: {error: 'Unexpected tester scope in browser test'}});
      if (url.pathname === path) return route.fulfill({json: state.snapshot});
      if (url.pathname === path + '/events') return route.fulfill({contentType: 'text/event-stream', headers: {'Cache-Control': 'no-cache'},
        body: 'retry: 60000\nevent: ready\ndata: {"cursor":1}\n\n'});
      return route.fulfill({status: 404, json: {error: 'Unexpected backend path in browser test'}});
    }
    // No other API may fall through to an actual service.
    if (url.pathname.startsWith('/api/')) return route.abort('blockedbyclient');
    return route.continue();
  });
  state.page = await context.newPage();
  state.page.setDefaultTimeout(8000); state.page.setDefaultNavigationTimeout(30000);
  state.page.on('pageerror', error => report.errors.push({locale, error: error.message}));
  return state;
}

async function ready(page, locale) {
  await page.locator('.app-guide:not(:disabled)').waitFor();
  await page.waitForFunction(expected => document.documentElement.lang === expected &&
    document.querySelector('.app-header .language-selector select')?.value === expected, locale);
  assert.deepEqual(await page.locator('.app-nav a').allTextContents(), labels[locale].nav);
}
async function replayReady(page) {await page.locator('.replay-workspace[aria-busy="false"]').waitFor();}
async function nativeNavigate(state, path) {
  const {page, locale} = state, before = await page.evaluate(() => window.__sourceNavigationDocument);
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame() && new URL(frame.url()).pathname === path),
    page.locator('.app-nav a[href="' + path + '"]').click()]);
  await ready(page, locale);
  assert.notEqual(await page.evaluate(() => window.__sourceNavigationDocument), before, 'Expected a native link to load a new document');
}
async function reload(state) {
  const before = await state.page.evaluate(() => window.__sourceNavigationDocument);
  await state.page.reload(); await ready(state.page, state.locale);
  assert.notEqual(await state.page.evaluate(() => window.__sourceNavigationDocument), before);
}
async function importSummary(page, item) {
  await page.locator('.replay-actions input[type=file]').setInputFiles({name: item.filename, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(item.data))});
  await page.locator('.replay-source > span').filter({hasText: item.filename}).waitFor(); await replayReady(page);
  await page.locator('.wafer-panel select').selectOption(item.selection.filter);
  await page.locator('.wafer-tile').filter({has: page.locator('strong', {hasText: 'W983'})}).click();
  await page.locator('.alert-selector button').nth(item.selection.alertIndex).click();
}
async function session(page) {return page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || 'null'), sessionKey);}
async function assertSession(page, item, mode) {
  const saved = await session(page);
  assert.ok(saved, 'Missing ' + sessionKey + '; expected imported source and replay selection');
  assert.equal(saved.version, 1); assert.equal(saved.mode, mode);
  assert.ok(saved.replay.filename.includes(item.filename), 'Saved filename lost the imported filename');
  assert.deepEqual(saved.replay.selection, item.selection, 'Saved replay selection changed');
  // Validation strips unrelated summary metadata; all accepted wafer/alert fields must survive.
  assert.deepEqual(saved.replay.data.wafers, item.data.wafers, 'Saved wafer records changed');
  assert.deepEqual(saved.replay.data.limitations, item.data.limitations);
}
async function assertReplay(page, item) {
  await replayReady(page); await page.locator('.replay-source > span').filter({hasText: item.filename}).waitFor();
  assert.ok((await page.locator('.replay-tabs [role=tab][aria-selected=true]').getAttribute('id')).endsWith('-trigger-' + item.selection.tab), 'Replay tab was not restored');
  if (item.selection.tab !== 'analysis') return;
  assert.equal(await page.locator('.wafer-panel select').inputValue(), item.selection.filter);
  assert.deepEqual(await page.locator('.wafer-tile strong').allTextContents(), ['W901', 'W983']);
  const selected = page.locator('.wafer-tile[aria-pressed=true]');
  assert.equal(await selected.locator('strong').innerText(), 'W983');
  assert.equal(await selected.getAttribute('aria-expanded'), String(item.selection.detailOpen));
  assert.equal(await page.locator('#replay-wafer-detail').isVisible(), item.selection.detailOpen);
  if (item.selection.detailOpen) {
    assert.equal(await page.locator('.alert-selector button').nth(1).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.original-message').innerText(), item.data.wafers[2].alerts[1].message);
  }
}
async function assertSummaryWorkspace(page, item) {
  await page.locator('.isw-app .isw-source').filter({hasText: item.filename}).waitFor();
  assert.equal(await page.locator('.isw-wafers select').inputValue(), item.selection.filter);
  assert.equal(await page.locator('.isw-wafer-list button[aria-pressed=true] strong').innerText(), 'W983');
  assert.equal(await page.locator('.isw-alerts button').nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#summary-wafer-detail .dc-message').innerText(), item.data.wafers[2].alerts[1].message);
  assert.deepEqual(await page.locator('.isw-wafer-list strong').allTextContents(), ['W901', 'W983']);
  const messages = [];
  for (const wafer of item.data.wafers.filter(wafer => wafer.alerts.length)) {
    const tile = page.locator('.isw-wafer-list button').filter({has: page.locator('strong', {hasText: 'W' + wafer.wafer})});
    if (await tile.getAttribute('aria-pressed') !== 'true') await tile.click();
    assert.equal(await page.locator('.isw-alerts button').count(), wafer.alerts.length);
    for (let i = 0; i < wafer.alerts.length; i++) {
      await page.locator('.isw-alerts button').nth(i).click();
      messages.push(await page.locator('#summary-wafer-detail .dc-message').innerText());
    }
  }
  // Traversal ends on the original W983 / alert 2, preserving the round-trip expectation.
  assert.deepEqual(messages.sort(), item.data.wafers.flatMap(wafer => wafer.alerts.map(alert => alert.message)).sort(), 'Workspace records do not match imported summary');
}
async function noBackend(state) {
  // Allow mount effects and delayed connection attempts before checking traffic.
  await state.page.waitForTimeout(250);
  assert.deepEqual(state.unexpectedBackend, [], 'Summary navigation attempted backend snapshot/SSE requests');
}
async function mobile(page, description) {
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const size = await page.evaluate(() => ({viewport: innerWidth, width: document.documentElement.scrollWidth}));
  assert.ok(size.width <= size.viewport + 1, description + ': document width ' + size.width + ' exceeds ' + size.viewport + 'px viewport');
  await page.setViewportSize({width: 1440, height: 1000});
}

async function flow(locale) {
  const state = await isolated(locale), {page} = state, item = fixture(locale);
  const run = (name, action) => check(locale + ': ' + name, action);
  try {
    if (!await run('import modified summary and select nonfirst wafer/alert/filter', async () => {
      await page.goto(base.href); await ready(page, locale); await replayReady(page);
      await importSummary(page, item); await assertReplay(page, item);
    })) return;
    await run('versioned session stores source data and complete selection', () => assertSession(page, item, 'summary'));
    await run('invalid JSON and schema preserve imported data and selection', async () => {
      const before = await session(page);
      for (const buffer of [Buffer.from('{invalid'), Buffer.from(JSON.stringify({mode: 'replay', wafers: []}))]) {
        await page.locator('.replay-actions input[type=file]').setInputFiles({name: 'invalid-source.json', mimeType: 'application/json', buffer});
        await page.locator('.inline-error').waitFor(); await replayReady(page);
        assert.match(await page.locator('.inline-error').innerText(), labels[locale].retained);
        await assertReplay(page, item); assert.deepEqual(await session(page), before, 'Invalid import mutated saved source');
      }
    });
    await run('imported replay has no 390px overflow', () => mobile(page, 'Imported replay'));
    await run('native workspace navigation keeps imported filename and records', async () => {
      await nativeNavigate(state, '/workspace'); await assertSummaryWorkspace(page, item); await assertSession(page, item, 'summary');
    });
    await run('summary workspace performs no backend GET or SSE', () => noBackend(state));
    await run('imported workspace has no 390px overflow', () => mobile(page, 'Summary workspace'));
    await run('workspace reload keeps imported source and records', async () => {
      await reload(state); await assertSummaryWorkspace(page, item); await assertSession(page, item, 'summary'); await noBackend(state);
    });
    await run('native return to replay preserves source and selection', async () => {
      await nativeNavigate(state, '/'); await assertReplay(page, item); await assertSession(page, item, 'summary');
    });
    await run('replay reload retains imported source and selection', async () => {
      await reload(state); await assertReplay(page, item); await assertSession(page, item, 'summary');
    });
    // Recover via real import after failures, never by injecting the session under test.
    await importSummary(page, item);
    await run('closed detail and validation tab survive native round-trip and reload', async () => {
      await page.locator('.wafer-tile[aria-pressed=true]').click(); item.selection.detailOpen = false;
      await page.locator('.replay-tabs [role=tab][id$="-trigger-validation"]').click(); item.selection.tab = 'validation';
      await nativeNavigate(state, '/workspace'); await nativeNavigate(state, '/'); await reload(state);
      await assertReplay(page, item); await assertSession(page, item, 'summary');
      await page.locator('.replay-tabs [role=tab][id$="-trigger-analysis"]').click(); item.selection.tab = 'analysis';
      await assertReplay(page, item); await assertSession(page, item, 'summary');
    });
    item.selection = {waferId: '983', alertIndex: 1, filter: 'alert', tab: 'analysis', detailOpen: true};
    await page.locator('.replay-tabs [role=tab][id$="-trigger-analysis"]').click(); await importSummary(page, item);
    await nativeNavigate(state, '/workspace');
    await run('no automatic backend traffic before explicit source switch', () => noBackend(state));
    const switched = await run('explicit Load backend run switches to mocked snapshot and SSE', async () => {
      const form = page.locator('form.dc-connect');
      await form.locator('input').nth(0).fill(state.snapshot.run.run_id); await form.locator('input').nth(1).fill(state.snapshot.run.tester_id);
      const load = form.locator('button[type=submit]');
      assert.equal((await load.innerText()).trim(), labels[locale].load, 'Source switch must be explicit and localized');
      state.backendAllowed = true; await load.click();
      await page.locator('.dc-detail .dc-message').filter({hasText: state.snapshot.events[0].message}).waitFor();
      await page.waitForFunction(() => document.querySelector('.dc-stream-status')?.textContent.length > 0);
      // The native EventSource request is independently observable even after a finite mock body closes.
      const deadline = Date.now() + 8000;
      while (!state.requests.some(request => request.type === 'eventsource') && Date.now() < deadline) await page.waitForTimeout(50);
      assert.ok(state.requests.some(request => request.allowed && request.path === '/api/v1/runs/' + state.snapshot.run.run_id), 'No backend snapshot requested');
      assert.ok(state.requests.some(request => request.allowed && request.type === 'eventsource'), 'No backend SSE requested');
      assert.equal(await page.locator('.dc-event-list button').count(), 1); await assertSession(page, item, 'backend');
    });
    if (switched) {
      await run('backend workspace has no 390px overflow', () => mobile(page, 'Backend workspace'));
      await run('backend reload restores explicit backend source without erasing replay', async () => {
        await reload(state); await page.locator('.dc-detail .dc-message').filter({hasText: state.snapshot.events[0].message}).waitFor();
        await assertSession(page, item, 'backend');
      });
    }
    await run('return from backend retains imported replay through reload', async () => {
      await nativeNavigate(state, '/'); state.backendAllowed = false;
      await assertReplay(page, item); await reload(state); await assertReplay(page, item);
      const saved = await session(page); assert.ok(['summary', 'backend'].includes(saved?.mode));
      await assertSession(page, item, saved.mode);
    });
    await run('no unexpected backend attempts throughout summary flow', () => noBackend(state));
  } catch (error) {await run('flow setup/transition', () => {throw error;});}
  finally {await state.context.close();}
}

try {
  for (const locale of onlyLocale ? [onlyLocale] : ['en', 'zh-TW']) await flow(locale);
  await check('No browser runtime errors', () => assert.deepEqual(report.errors, []));
  await check('No state-changing or nonlocal request attempted; all POSTs blocked', () => assert.deepEqual(report.blockedRequests, []));
  report.passed = report.checks.filter(check => check.passed).length; report.failed = report.checks.filter(check => !check.passed).length;
  console.log(JSON.stringify(report, null, 2)); if (report.failed) process.exitCode = 1;
} finally {await browser.close();}
