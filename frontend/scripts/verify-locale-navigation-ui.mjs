// Local browser regressions. No installs, artifacts, paid calls, or state-changing requests.
// node frontend/scripts/verify-locale-navigation-ui.mjs [http://localhost:5173] [--only=flash|tour|fallback]
// PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE follow verify-tour-ui.mjs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const args = process.argv.slice(2);
const base = new URL(args.find(arg => !arg.startsWith('--')) || 'http://localhost:5173');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Loopback preview required');
assert.ok(['http:', 'https:'].includes(base.protocol));
assert.equal(base.pathname, '/', 'Use the preview origin without a route');
const only = args.find(arg => arg.startsWith('--only='))?.slice(7);
assert.ok(!only || ['flash', 'tour', 'fallback'].includes(only), 'Unknown --only group');
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE} : {})});
const checks = [], blocked = [];
const localeKey = 'rtdi.locale', visitKey = 'rtdi-guided-tour-visit-v1';
const labels = {en: ['Replay analysis', 'Run workspace', 'Sandbox'], 'zh-TW': ['重播分析', '批次工作區', '沙盒']};
const headings = {en: ['Replay analysis', 'Run overview', 'Event sandbox'], 'zh-TW': ['重播分析', '批次總覽', '事件沙盒']};

async function check(name, fn) {
  try {
    await fn();
    checks.push({name, passed: true});
    console.log('PASS ' + name);
  } catch (error) {
    checks.push({name, passed: false, error: error.message});
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

async function isolated({locale, cookies = [], dismissed = false, javaScriptEnabled = true, denyStorage = false} = {}) {
  const localStorage = [];
  if (locale) localStorage.push({name: localeKey, value: locale}, {name: 'rtdi.response-language', value: locale});
  if (dismissed) localStorage.push({name: visitKey, value: JSON.stringify({version: 1, status: 'dismissed'})});
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', javaScriptEnabled, serviceWorkers: 'block',
    storageState: {cookies, origins: [{origin: base.origin, localStorage}]},
  });
  // One gate per context, released explicitly after the pre-hydration DOM check.
  let gate = null;
  const control = {
    hold() {
      assert.equal(gate, null);
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      gate = {promise, release, requests: 0};
      return gate;
    },
    release() { const pending = gate; gate = null; pending?.release(); },
  };
  await context.route('**/*', async route => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) {
      blocked.push({method: request.method(), url: request.url()});
      return route.abort();
    }
    if (new URL(request.url()).origin !== base.origin) return route.abort();
    if (gate && request.resourceType() === 'script') {
      const pending = gate;
      pending.requests++;
      await pending.promise;
    }
    await route.continue();
  });
  if (denyStorage) await context.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, {
      get() { throw new DOMException('Storage denied by regression check', 'SecurityError'); },
    });
  });
  // Sample actual rendered labels every animation frame, including the first
  // frames after releasing scripts. Changing html.lang alone cannot pass this.
  await context.addInitScript(() => {
    history.scrollRestoration = 'manual';
    const probe = window.__localeNavigationProbe = {id: Math.random().toString(36), samples: [], frames: 0, active: true};
    const visible = el => {
      if (!el.getClientRects().length) return false;
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    };
    const sample = () => {
      if (!probe.active) return;
      probe.frames++;
      const texts = [...document.querySelectorAll('.app-nav a')].filter(visible).map(el => el.innerText.trim());
      const headings = [...document.querySelectorAll('main h1')].filter(visible).map(el => el.innerText.trim());
      const previous = probe.samples.at(-1);
      if (!previous || JSON.stringify([previous.texts, previous.headings]) !== JSON.stringify([texts, headings])) probe.samples.push({at: Math.round(performance.now()), texts, headings});
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return {context, page, control, errors};
}

const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
async function ready(page) {
  await page.locator('.app-guide:not(:disabled)').waitFor();
}
async function settled(page, locale) {
  await ready(page);
  await page.waitForFunction(expected => document.documentElement.lang === expected &&
    document.querySelector('.app-header .language-selector select')?.value === expected, locale);
  assert.deepEqual(await page.locator('.app-nav a').allTextContents(), labels[locale]);
  assert.ok(headings[locale].includes((await page.locator('main h1').innerText()).trim()), 'Page heading must match the selected language');
  assert.equal(await page.locator('.app-nav a').first().isVisible(), true, 'Localized navigation must become visible');
}
async function select(page, value, scope = page.locator('.app-header')) {
  await scope.locator('.language-selector select').selectOption(value);
  await settled(page, value);
}

async function earlyNavigation(test, path, locale, kind = 'goto', requireVisibleSSR = false, holdMs = 0) {
  const {page, control} = test;
  const previous = await page.evaluate(() => window.__localeNavigationProbe?.id);
  const hold = control.hold();
  let before;
  try {
    if (kind === 'tab') {
      await Promise.all([
        page.waitForEvent('framenavigated', frame => frame === page.mainFrame() && new URL(frame.url()).pathname === path),
        page.locator('.app-nav a[href="' + path + '"]').click({noWaitAfter: true}),
      ]);
    } else if (kind === 'reload') await page.reload({waitUntil: 'commit'});
    else await page.goto(new URL(path, base).href, {waitUntil: 'commit'});
    await page.locator('.app-nav a').first().waitFor({state: 'attached'});
    await page.evaluate(() => window.scrollTo(0, 0));
    await frames(page);
    if (holdMs) {
      // Intentionally exceed the bootstrap's five-second recovery timer while
      // external scripts are still pending. Inspect every sampled frame, not
      // only the final DOM, so a transient English reveal also fails.
      await page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), holdMs);
      await frames(page);
      assert.notEqual(await page.evaluate(() => document.readyState), 'complete', 'Delayed scripts must still prevent window load');
    }
    before = await page.evaluate(() => window.__localeNavigationProbe);
    assert.notEqual(before.id, previous, 'Expected a new document, not client-only routing');
    assert.ok(hold.requests > 0, 'No client script intercepted; pre-hydration check is invalid');
    console.log('EARLY ' + JSON.stringify({path, locale, kind, holdMs, heldScripts: hold.requests, samples: before.samples}));
    const wrongBefore = before.samples.filter(sample => sample.texts.some(text => !labels[locale].includes(text)) || sample.headings.some(text => !headings[locale].includes(text)));
    assert.deepEqual(wrongBefore, [], 'Visible wrong-language DOM while client scripts are held: ' + JSON.stringify(wrongBefore));
    if (requireVisibleSSR) assert.deepEqual(before.samples.at(-1).texts, labels[locale], 'Cookie SSR must already show the saved language before hydration');
  } finally { control.release(); }
  await settled(page, locale);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.__localeNavigationProbe.samples.some(sample => sample.texts.length === 3));
  await frames(page);
  const after = await page.evaluate(() => {
    window.__localeNavigationProbe.active = false;
    return window.__localeNavigationProbe;
  });
  assert.equal(new URL(page.url()).pathname, path);
  const saved = await page.evaluate(key => localStorage.getItem(key), localeKey);
  if (saved !== null) assert.equal(saved, locale);
  const wrong = after.samples.filter(sample => sample.texts.some(text => !labels[locale].includes(text)) || sample.headings.some(text => !headings[locale].includes(text)));
  assert.deepEqual(wrong, [], 'Visible wrong-language DOM before/during hydration: ' + JSON.stringify(wrong));
  assert.ok(after.samples.some(sample => sample.texts.length === 3), 'Probe never observed visible navigation');
}

async function flashChecks() {
  const slowLegacy = await isolated({locale: 'zh-TW', dismissed: true});
  try {
    await check('Storage-only zh-TW: 5.5-second script delay never exposes English', async () => {
      await earlyNavigation(slowLegacy, '/', 'zh-TW', 'goto', false, 5500);
      assert.deepEqual(slowLegacy.errors, []);
    });
  } finally { slowLegacy.control.release(); await slowLegacy.context.close(); }
  // Fresh contexts ensure each route exercises existing storage-only users,
  // even when the new bootstrap migrates preferences into an SSR cookie.
  for (const path of ['/workspace', '/sandbox']) {
    const legacy = await isolated({locale: 'zh-TW', dismissed: true});
    try {
      await check('Storage-only zh-TW: cold document ' + path, () => earlyNavigation(legacy, path, 'zh-TW'));
    } finally { legacy.control.release(); await legacy.context.close(); }
  }
  const test = await isolated({locale: 'zh-TW', dismissed: true});
  try {
    await check('Saved zh-TW: first document has no visible English flash', () => earlyNavigation(test, '/', 'zh-TW'));
    for (const path of ['/workspace', '/sandbox', '/']) {
      await check('Saved zh-TW: native tab navigation to ' + path, () => earlyNavigation(test, path, 'zh-TW', 'tab'));
      await check('Saved zh-TW: reload ' + path, () => earlyNavigation(test, path, 'zh-TW', 'reload'));
    }
    await check('Switch back to English through the header selector', () => select(test.page, 'en'));
    for (const path of ['/workspace', '/sandbox', '/']) {
      await check('Saved en: native tab navigation to ' + path, () => earlyNavigation(test, path, 'en', 'tab'));
    }
    await check('Saved en: reload remains English', () => earlyNavigation(test, '/', 'en', 'reload'));
    await check('Navigation has no browser runtime errors', async () => assert.deepEqual(test.errors, []));
  } finally { test.control.release(); await test.context.close(); }
  await check('Preference cookie can be obtained through language selection', async () => {
    // Obtain the real preference cookie by using the public selector; avoid
    // coupling the regression to a private cookie name or encoding.
    const source = await isolated({dismissed: true});
    let cookies;
    try {
      await source.page.goto(base.href);
      await ready(source.page);
      await select(source.page, 'zh-TW');
      cookies = await source.context.cookies(base.origin);
      assert.ok(cookies.length > 0, 'Selecting Chinese must persist a server-readable preference cookie');
    } finally { await source.context.close(); }
    for (const javaScriptEnabled of [true, false]) {
      const cookieOnly = await isolated({cookies, dismissed: true, javaScriptEnabled});
      try {
        for (const path of ['/', '/workspace', '/sandbox']) {
          await check('Cookie-only zh-TW: ' + (javaScriptEnabled ? 'visible SSR ' : 'no-JS fallback ') + path, async () => {
            if (javaScriptEnabled) await earlyNavigation(cookieOnly, path, 'zh-TW', 'goto', true);
            else {
              await cookieOnly.page.goto(new URL(path, base).href);
              await cookieOnly.page.locator('.app-nav a').first().waitFor();
              assert.deepEqual(await cookieOnly.page.locator('.app-nav a').allTextContents(), labels['zh-TW']);
              assert.ok(headings['zh-TW'].includes((await cookieOnly.page.locator('main h1').innerText()).trim()), 'No-JS heading must match the preference cookie');
              assert.equal(await cookieOnly.page.locator('main').isVisible(), true);
            }
          });
        }
        if (javaScriptEnabled) {
          await select(cookieOnly.page, 'en');
          await earlyNavigation(cookieOnly, '/sandbox', 'en', 'reload');
          const english = await isolated({cookies: await cookieOnly.context.cookies(base.origin), javaScriptEnabled: false});
          try {
            await english.page.goto(base.href);
            await english.page.locator('.app-nav a').first().waitFor();
            assert.deepEqual(await english.page.locator('.app-nav a').allTextContents(), labels.en);
          } finally { await english.context.close(); }
        }
        await check('Cookie-only ' + (javaScriptEnabled ? 'JS' : 'no-JS') + ': no browser runtime errors', async () => assert.deepEqual(cookieOnly.errors, []));
      } finally { cookieOnly.control.release(); await cookieOnly.context.close(); }
    }
  });
}

async function tourChecks() {
  for (const path of ['/', '/workspace', '/sandbox']) {
    const test = await isolated();
    const {page} = test;
    try {
      await check('First-visit and active guide language selectors on ' + path, async () => {
        await page.goto(new URL(path, base).href);
        const card = page.locator('.rtdi-tour-card');
        await page.locator('.rtdi-tour-card[data-step="chapters"]').waitFor();
        assert.equal(await card.count(), 1);
        const selector = card.locator('.language-selector select');
        assert.equal(await selector.count(), 1, 'First-visit popup needs its own language selector inside the modal');
        await selector.waitFor();
        assert.equal(await selector.isEnabled(), true);
        const title = await card.locator('#rtdi-tour-title').innerText();
        await select(page, 'zh-TW', card);
        assert.notEqual(await card.locator('#rtdi-tour-title').innerText(), title);
        assert.match(await card.locator('#rtdi-tour-title').innerText(), /[\u3400-\u9fff]/);
        assert.equal(await card.getAttribute('data-step'), 'chapters', 'Selecting a language must keep the welcome open');
        await card.locator('.rtdi-tour-chapters a[href="' + path + '"]').click();
        await page.locator('.rtdi-tour-progress').waitFor();
        const step = await card.getAttribute('data-step');
        const chineseTitle = await card.locator('#rtdi-tour-title').innerText();
        assert.equal(await card.locator('.language-selector select').count(), 1, 'Active guide needs a language selector');
        await select(page, 'en', card);
        assert.equal(await card.getAttribute('data-step'), step, 'Language choice must preserve the active step');
        assert.notEqual(await card.locator('#rtdi-tour-title').innerText(), chineseTitle);
        assert.doesNotMatch(await card.locator('#rtdi-tour-title').innerText(), /[\u3400-\u9fff]/);
        await select(page, 'zh-TW', card);
        assert.equal(await card.getAttribute('data-step'), step);
        await page.keyboard.press('Escape');
        await card.waitFor({state: 'detached'});
        await page.reload();
        await settled(page, 'zh-TW');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), localeKey), 'zh-TW');
        assert.equal(await card.count(), 0, 'Dismissed welcome must stay dismissed');
        assert.deepEqual(test.errors, []);
      });
    } finally { test.control.release(); await test.context.close(); }
  }
}

async function fallbackChecks() {
  await check('No JavaScript: English fallback stays visible on every route', async () => {
    // A browser without JS cannot read localStorage; even saved Chinese must not leave a blank shell.
    const test = await isolated({locale: 'zh-TW', javaScriptEnabled: false});
    try {
      for (const path of ['/', '/workspace', '/sandbox']) {
        await test.page.goto(new URL(path, base).href);
        await test.page.locator('.app-nav a').first().waitFor();
        assert.deepEqual(await test.page.locator('.app-nav a').allTextContents(), labels.en);
        assert.equal(await test.page.locator('main').isVisible(), true);
      }
    } finally { await test.context.close(); }
  });
  await check('Denied storage: English fallback and in-memory switching remain usable', async () => {
    const test = await isolated({denyStorage: true});
    try {
      for (const path of ['/', '/workspace', '/sandbox']) {
        await test.page.goto(new URL(path, base).href);
        await settled(test.page, 'en');
        await test.page.locator('.rtdi-tour-card[data-step="chapters"]').waitFor();
        await test.page.keyboard.press('Escape');
        await test.page.locator('.rtdi-tour-card').waitFor({state: 'detached'});
        await select(test.page, 'zh-TW');
        await select(test.page, 'en');
      }
      assert.deepEqual(test.errors, []);
    } finally { await test.context.close(); }
  });
}

try {
  if (!only || only === 'flash') await flashChecks();
  if (!only || only === 'tour') await tourChecks();
  if (!only || only === 'fallback') await fallbackChecks();
  await check('No state-changing request attempted (all POSTs blocked)', async () => assert.deepEqual(blocked, []));
  console.log(JSON.stringify({passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, checks, blockedRequests: blocked, realPosts: 0, limits: 'Local browser UI only; no model or deployment acceptance.'}, null, 2));
  if (checks.some(check => !check.passed)) process.exitCode = 1;
} finally { await browser.close(); }
