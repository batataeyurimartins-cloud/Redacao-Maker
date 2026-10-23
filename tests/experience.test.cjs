'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test: nodeTest, before, after } = require('node:test');
const { chromium } = require('playwright');

const ORIGIN = 'https://fixture.redator.test';
const API_URL = 'https://redacao-maker.vercel.app/api/generate';
const TITLE = 'Bibliotecas e cidadania digital';
const ESSAY = 'As bibliotecas públicas ampliam o acesso ao conhecimento.\n\nInvestir nesses espaços favorece a cidadania digital.';
const DRAFT_TITLE = 'Meu título em elaboração';
const DRAFT_ESSAY = 'Meu rascunho ainda está em elaboração.';
const LEVELS = ['1 — Bem simples', '2 — Fraco', '3 — Médio', '4 — Bom', '5 — Máximo'];
const test = (name, run) => nodeTest(name, { timeout: 25000 }, run);

let browser;
let script;

before(async () => {
  script = fs.readFileSync(path.join(__dirname, '..', 'redator-groq.js'), 'utf8');
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});

after(async () => { await browser?.close(); });

function completion(finishReason = 'stop', essay = ESSAY) {
  return { title: TITLE, choices: [{ message: { role: 'assistant', content: essay }, finish_reason: finishReason }] };
}

function hostForm() {
  return `<form><label for="host-title">Título da redação</label><input id="host-title" value="${DRAFT_TITLE}">
    <label for="host-essay">Texto da redação</label><textarea id="host-essay">${DRAFT_ESSAY}</textarea>
    <button type="submit">Enviar redação</button></form>`;
}

function html(content = hostForm()) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Atividade de redação</title>
    <style>body{margin:16px;font-family:sans-serif}main{max-width:480px}label,input,textarea{display:block}input,textarea{width:100%;box-sizing:border-box}textarea{height:100px}</style>
    </head><body><main><h1>Bibliotecas e inclusão digital</h1>
    <p>Bibliotecas públicas oferecem acesso gratuito à internet e oportunidades de estudo.</p>${content}</main>
    <script>window.hostSubmits=0;document.addEventListener('submit',event=>{event.preventDefault();window.hostSubmits++})</script></body></html>`;
}

function control(page, id) {
  return page.locator(`#redator-groq-console >> #${id}`);
}

function notifications(page) {
  return control(page, 'notifications').locator('.notification');
}

async function json(route, status, payload) {
  return route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS' }, body: status === 204 ? '' : JSON.stringify(payload) });
}

async function mount(t, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1400, height: 1000 },
    reducedMotion: options.reducedMotion || 'reduce',
  });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(5000);
  const page = await context.newPage();
  const requests = [];
  const unexpected = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(unexpected, [], 'experience tests must never reach a live API or provider');
    assert.deepEqual(pageErrors, [], 'UI interactions must not produce uncaught browser errors');
  });
  await context.addInitScript(clipboardMode => {
    window.copiedForTest = [];
    window.animationCallsForTest = 0;
    const nativeAnimate = Element.prototype.animate;
    if (nativeAnimate) Element.prototype.animate = function (...args) {
      window.animationCallsForTest += 1;
      return nativeAnimate.apply(this, args);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async value => {
        if (clipboardMode === 'denied') throw new DOMException('Clipboard denied', 'NotAllowedError');
        window.copiedForTest.push(value);
      },
    } });
  }, options.clipboard || 'success');
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url() === `${ORIGIN}/`) return route.fulfill({ status: 200, contentType: 'text/html', body: html(options.content) });
    if (request.url() === API_URL) {
      for (const name of ['authorization', 'x-api-key', 'api-key', 'x-access-token', 'x-hub-token', 'cookie']) {
        assert.equal(request.headers()[name], undefined, `public generation must not send ${name}`);
      }
      if (request.method() === 'OPTIONS') return json(route, 204, null);
      assert.equal(request.method(), 'POST');
      requests.push(request.postDataJSON());
      return options.api ? options.api(route, requests.length) : json(route, 200, completion());
    }
    unexpected.push(request.url());
    return route.abort();
  });
  await page.goto(`${ORIGIN}/`);
  if (options.clock) await page.clock.install();
  await page.addScriptTag({ content: script });
  await page.locator('#redator-groq-console').waitFor();
  await page.evaluate(() => {
    const root = document.getElementById('redator-groq-console').shadowRoot;
    window.notificationHistoryForTest = [];
    const record = () => {
      for (const notice of root.querySelectorAll('#notifications .notification')) {
        const entry = { id: notice.dataset.notificationId, kind: notice.dataset.kind,
          title: notice.querySelector('.notification-title')?.textContent || '', text: notice.textContent };
        if (entry.title) window.notificationHistoryForTest.push(entry);
      }
    };
    new MutationObserver(record).observe(root.getElementById('notifications'), { subtree: true, childList: true, characterData: true });
  });
  return { page, requests };
}

async function openPane(page, name) {
  if (!await control(page, `pane-${name}`).isVisible()) await control(page, `open-${name}`).click();
  await control(page, `pane-${name}`).waitFor({ state: 'visible' });
}

async function closePane(page) {
  if (await control(page, 'secondary-panel').isVisible()) await control(page, 'secondary-close').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
}

async function ready(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('redator-groq-console')?.shadowRoot;
    return root && !root.getElementById('generate').disabled;
  }, null, { timeout: 5000 });
}

async function generate(page) {
  await closePane(page);
  const response = page.waitForResponse(API_URL, { timeout: 5000 });
  await control(page, 'generate').click();
  await response;
  await ready(page);
}

async function expectToast(page, pattern, kind) {
  await page.waitForFunction(({ source, flags, kind }) => {
    const root = document.getElementById('redator-groq-console')?.shadowRoot;
    return [...(root?.querySelectorAll('#notifications .notification') || [])].some(node =>
      new RegExp(source, flags).test(node.textContent) && (!kind || node.dataset.kind === kind));
  }, { source: pattern.source, flags: pattern.flags, kind }, { timeout: 5000 });
}

async function history(page) {
  return page.evaluate(() => window.notificationHistoryForTest);
}

async function assertNoSuccess(page) {
  const entries = await history(page);
  assert.ok(entries.every(entry => entry.title !== 'Redação realizada' && entry.title !== 'Redação preenchida'),
    `an unsuccessful generation must not announce success: ${JSON.stringify(entries)}`);
}

async function dismissAll(page) {
  await notifications(page).locator('.notification-close').evaluateAll(buttons => buttons.forEach(button => button.click()));
  await page.waitForFunction(() => !document.getElementById('redator-groq-console').shadowRoot.querySelector('#notifications .notification'));
}

test('shows the five requested levels, defaults to Médio, and sends a numeric level without browser model settings', async t => {
  const { page, requests } = await mount(t);
  assert.equal(await control(page, 'level').inputValue(), '3');
  assert.equal(await control(page, 'summary-genre').innerText(), LEVELS[2]);
  assert.equal(await page.locator('#redator-groq-console').locator('#model, #genre, #open-connection, #pane-connection, input[type="password"]').count(), 0);
  assert.doesNotMatch(await page.locator('#redator-groq-console').evaluate(host => host.shadowRoot.textContent), /gpt-oss|llama-|modelo da groq|usar este modelo|gsk_/i);
  assert.equal(await page.locator('#redator-groq-console >> .setting-row').count(), 5);
  await openPane(page, 'genre');
  assert.deepEqual(await control(page, 'pane-genre').locator('[data-choice="level"] .choice-label').allTextContents(), LEVELS);
  assert.equal(await control(page, 'choice-level-3').getAttribute('aria-pressed'), 'true');
  assert.equal(await control(page, 'pane-genre').locator('[aria-pressed="true"]').count(), 1);
  await closePane(page);
  await generate(page);
  assert.equal(requests[0].level, 3, 'the untouched default must also be sent as a number');
  for (let level = 1; level <= 5; level += 1) {
    await openPane(page, 'genre');
    await control(page, `choice-level-${level}`).click();
    await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
    assert.equal(await control(page, 'level').inputValue(), String(level));
    assert.equal(await control(page, 'summary-genre').innerText(), LEVELS[level - 1]);
    await generate(page);
    const payload = requests.at(-1);
    assert.deepEqual(Object.keys(payload).sort(), ['context', 'instructions', 'level', 'theme', 'words']);
    assert.equal(payload.level, level);
    assert.equal(typeof payload.level, 'number');
    assert.equal(payload.words, 350);
    assert.equal(payload.theme, '');
    assert.equal(payload.instructions, '');
    assert.match(payload.context, /Bibliotecas públicas/);
    assert.doesNotMatch(JSON.stringify(payload), /openai\/|gsk_|GROQ_API_KEY|Bearer\s/i);
  }
  assert.equal(requests.length, 6);
});

test('announces generation and actual complete autofill as two distinct accessible notifications', async t => {
  const { page } = await mount(t);
  await generate(page);
  assert.equal(await page.locator('#host-title').inputValue(), TITLE);
  assert.equal(await page.locator('#host-essay').inputValue(), ESSAY);
  assert.equal(await page.evaluate(() => window.hostSubmits), 0);
  const entries = await notifications(page).evaluateAll(nodes => nodes.map(node => ({
    title: node.querySelector('.notification-title').textContent, id: node.dataset.notificationId,
    kind: node.dataset.kind, role: node.getAttribute('role'), live: node.getAttribute('aria-live'),
  })));
  const generated = entries.find(entry => entry.title === 'Redação realizada');
  const filled = entries.find(entry => entry.title === 'Redação preenchida');
  assert.ok(generated, JSON.stringify(entries));
  assert.ok(filled, JSON.stringify(entries));
  assert.notEqual(generated.id, filled.id);
  for (const entry of [generated, filled]) {
    assert.equal(entry.kind, 'success');
    assert.equal(entry.role, 'status');
    assert.equal(entry.live, 'polite');
  }
});

test('reports partial autofill without claiming that both title and essay were filled', async t => {
  const { page } = await mount(t, { content: '<label for="host-title">Título da redação</label><input id="host-title" value="Rascunho">' });
  await generate(page);
  assert.equal(await page.locator('#host-title').inputValue(), TITLE);
  assert.equal(await control(page, 'result').inputValue(), ESSAY);
  await expectToast(page, /parcialmente preenchida|preenchimento parcial/i, 'warning');
  const entries = await history(page);
  assert.ok(entries.some(entry => entry.title === 'Redação realizada'));
  assert.ok(entries.every(entry => entry.title !== 'Redação preenchida'));
});

test('keeps incomplete and failed responses truthful and preserves the host draft', async t => {
  for (const scenario of [
    { label: 'truncated', status: 200, body: completion('length', 'Um texto que terminou antes da conclusão'), pattern: /incomplet|limite|interrompid|truncad/i },
    { label: 'API error', status: 503, body: { error: { message: 'Serviço temporariamente indisponível.' } }, pattern: /não foi possível gerar|indispon|erro|serviço/i },
    { label: 'empty completion', status: 200, body: completion('stop', '   '), pattern: /não foi possível gerar|vazia|inválid/i },
  ]) {
    const { page } = await mount(t, { api: route => json(route, scenario.status, scenario.body) });
    await generate(page);
    await expectToast(page, scenario.pattern);
    assert.equal(await page.locator('#host-title').inputValue(), DRAFT_TITLE, scenario.label);
    assert.equal(await page.locator('#host-essay').inputValue(), DRAFT_ESSAY, scenario.label);
    await assertNoSuccess(page);
  }
});

test('cancels a pending generation and ignores a later successful response without a success notification', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { page } = await mount(t, { api: async route => {
    await gate;
    await json(route, 200, completion()).catch(() => {});
  } });
  const requested = page.waitForRequest(API_URL, { timeout: 5000 });
  await control(page, 'generate').click();
  await requested;
  await control(page, 'cancel').click();
  await ready(page);
  await expectToast(page, /Geração cancelada/i, 'warning');
  release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#host-title').inputValue(), DRAFT_TITLE);
  assert.equal(await page.locator('#host-essay').inputValue(), DRAFT_ESSAY);
  assert.equal(await control(page, 'result').inputValue(), '');
  await assertNoSuccess(page);
});

test('gives meaningful feedback for capture, saved settings, copy, download and clipboard failure', async t => {
  const { page } = await mount(t);
  await openPane(page, 'source');
  await control(page, 'capture-page').click();
  await expectToast(page, /capturad|referência|página|texto/i);
  await openPane(page, 'source');
  await control(page, 'context').fill('Bibliotecas oferecem inclusão digital e formação para a cidadania.');
  await control(page, 'save-source').click();
  await expectToast(page, /referência|texto/i);
  await openPane(page, 'genre');
  await control(page, 'choice-level-5').click();
  await expectToast(page, /tipo|nível|máximo/i);
  await openPane(page, 'writing');
  await control(page, 'theme').fill('Bibliotecas e cidadania');
  await control(page, 'save-writing').click();
  await expectToast(page, /tema|instruções/i);
  await generate(page);
  await control(page, 'copy').click();
  await expectToast(page, /copiad/i, 'success');
  assert.ok((await page.evaluate(() => window.copiedForTest)).some(text => text.includes(ESSAY)));
  const downloading = page.waitForEvent('download', { timeout: 5000 });
  await control(page, 'download').click();
  assert.match((await downloading).suggestedFilename(), /\.txt$/);
  await expectToast(page, /baix|download|arquivo/i, 'success');

  const { page: denied } = await mount(t, { clipboard: 'denied' });
  await generate(denied);
  await dismissAll(denied);
  await denied.evaluate(() => { window.notificationHistoryForTest = []; });
  await control(denied, 'copy').click();
  await expectToast(denied, /copiar|cópia|área de transferência/i, 'warning');
  assert.ok((await history(denied)).every(entry => !/copiad/i.test(entry.title)));
  assert.deepEqual(await control(denied, 'result').evaluate(node => ({ start: node.selectionStart, end: node.selectionEnd })),
    { start: 0, end: ESSAY.length }, 'clipboard failure must offer the complete text for manual copy');
});

test('bounds and deduplicates the notification stack, pauses expiry, supports dismissal and cleans up on close', async t => {
  const { page } = await mount(t, { clock: true });
  await generate(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await dismissAll(page);
  await page.evaluate(() => {
    const schedule = window.setTimeout.bind(window);
    const cancel = window.clearTimeout.bind(window);
    window.activeTimeoutsForTest = new Set();
    window.setTimeout = (callback, delay, ...args) => {
      let handle;
      handle = schedule(() => {
        window.activeTimeoutsForTest.delete(handle);
        callback(...args);
      }, delay);
      window.activeTimeoutsForTest.add(handle);
      return handle;
    };
    window.clearTimeout = handle => {
      window.activeTimeoutsForTest.delete(handle);
      return cancel(handle);
    };
  });
  await control(page, 'copy').click();
  const copyNotice = notifications(page).filter({ hasText: /copiad/i });
  await copyNotice.waitFor();
  const copyId = await copyNotice.getAttribute('data-notification-id');
  await copyNotice.evaluate(node => { node.dataset.identityForTest = 'original'; });
  for (let index = 0; index < 4; index += 1) await control(page, 'copy').click();
  assert.equal(await notifications(page).count(), 1);
  assert.equal(await copyNotice.getAttribute('data-notification-id'), copyId);
  assert.equal(await copyNotice.getAttribute('data-identity-for-test'), 'original', 'repeated actions update the same node');
  await page.clock.fastForward(2000);
  await copyNotice.hover();
  await page.clock.fastForward(10000);
  assert.equal(await copyNotice.count(), 1, 'hover must pause automatic dismissal');
  await page.mouse.move(1, 1);
  await copyNotice.locator('.notification-close').focus();
  await page.clock.fastForward(10000);
  assert.equal(await copyNotice.count(), 1, 'keyboard focus must pause automatic dismissal');
  await control(page, 'generate').focus();
  await page.clock.fastForward(2999);
  assert.equal(await copyNotice.count(), 1, 'expiry must preserve the time remaining before hover');
  await page.clock.fastForward(2);
  assert.equal(await copyNotice.count(), 0);

  await control(page, 'copy').click();
  await closePane(page);
  for (const level of [1, 2, 4, 5]) {
    await openPane(page, 'genre');
    await control(page, `choice-level-${level}`).click();
    assert.ok(await notifications(page).count() <= 3);
  }
  await openPane(page, 'source');
  await control(page, 'capture-page').click();
  await openPane(page, 'writing');
  await control(page, 'save-writing').click();
  const ids = await notifications(page).evaluateAll(nodes => nodes.map(node => node.dataset.notificationId));
  assert.equal(ids.length, 3, 'distinct actions must keep only the last three notices');
  assert.equal(new Set(ids).size, 3);
  const first = notifications(page).first();
  const dismissedId = await first.getAttribute('data-notification-id');
  await first.locator('.notification-close').click();
  assert.equal(await notifications(page).count(), 2);
  assert.ok(!(await notifications(page).evaluateAll(nodes => nodes.map(node => node.dataset.notificationId))).includes(dismissedId));
  await page.mouse.move(1, 1);
  await control(page, 'generate').focus();
  assert.equal(await page.evaluate(() => window.activeTimeoutsForTest.size), 2, 'each remaining notice has one expiry timer');
  await control(page, 'close').click();
  await page.locator('#redator-groq-console').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.activeTimeoutsForTest.size), 0, 'closing the hub clears all notification timers');
  await page.clock.fastForward(60000);
  assert.equal(await page.locator('#redator-groq-console').count(), 0);
  await page.addScriptTag({ content: script });
  assert.ok(await notifications(page).count() <= 1, 'reopening must not restore notices from the disposed hub');
});

test('respects reduced motion for JavaScript and CSS and hides panes and collapsed content immediately', async t => {
  const { page } = await mount(t, { reducedMotion: 'reduce' });
  const state = await page.evaluate(() => {
    const root = document.getElementById('redator-groq-console').shadowRoot;
    root.getElementById('open-source').click();
    const opened = !root.getElementById('secondary-panel').hidden;
    root.getElementById('secondary-close').click();
    const closed = root.getElementById('secondary-panel').hidden;
    root.getElementById('minimize').click();
    const collapsed = root.getElementById('panel-body').hidden;
    root.getElementById('minimize').click();
    const expanded = !root.getElementById('panel-body').hidden;
    const styledAnimations = [...root.querySelectorAll('*')].filter(node => {
      const css = getComputedStyle(node);
      return [...css.animationDuration.split(','), ...css.transitionDuration.split(',')].some(value => parseFloat(value) > 0);
    }).map(node => node.id || node.className);
    return { opened, closed, collapsed, expanded, styledAnimations, animations: window.animationCallsForTest };
  });
  assert.deepEqual(state, { opened: true, closed: true, collapsed: true, expanded: true, styledAnimations: [], animations: 0 });
  await generate(page);
  await control(page, 'copy').click();
  await notifications(page).first().locator('.notification-close').click();
  assert.equal(await page.evaluate(() => window.animationCallsForTest), 0);
});

test('keeps the final pane and collapse state correct after rapid animated transitions', async t => {
  const { page } = await mount(t, { reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const root = document.getElementById('redator-groq-console').shadowRoot;
    for (let index = 0; index < 8; index += 1) {
      root.getElementById('open-source').click();
      root.getElementById('secondary-close').click();
      root.getElementById('open-genre').click();
      root.getElementById('open-words').click();
      root.getElementById('secondary-close').click();
    }
    root.getElementById('minimize').click();
    root.getElementById('minimize').click();
    root.getElementById('open-words').click();
  });
  await page.waitForFunction(() => {
    const root = document.getElementById('redator-groq-console').shadowRoot;
    const panel = root.getElementById('secondary-panel');
    return !panel.hidden && !root.getElementById('pane-words').hidden && getComputedStyle(panel).opacity === '1';
  });
  assert.equal(await control(page, 'pane-source').isVisible(), false);
  assert.equal(await control(page, 'pane-genre').isVisible(), false);
  assert.equal(await control(page, 'open-words').getAttribute('aria-expanded'), 'true');
  assert.equal(await control(page, 'panel-body').isVisible(), true);
  await control(page, 'secondary-close').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'main-panel').getAttribute('data-secondary-open'), 'false');
  assert.equal(await control(page, 'open-words').getAttribute('aria-expanded'), 'false');
  assert.ok(await page.evaluate(() => window.animationCallsForTest) > 0, 'normal motion should animate transitions');
});

test('reinjects a working hub while the previous hub is still animating closed', async t => {
  const { page } = await mount(t, { reducedMotion: 'no-preference' });
  const replaced = await page.evaluate(source => {
    const previous = document.getElementById('redator-groq-console');
    previous.shadowRoot.getElementById('close').click();
    eval(source);
    window.closedHubForTest = previous;
    window.replacementHubForTest = document.getElementById('redator-groq-console');
    return !!window.replacementHubForTest && window.replacementHubForTest !== previous;
  }, script);
  assert.equal(replaced, true, 'reinjection during close must create a fresh, usable hub');
  await page.waitForFunction(() => !window.closedHubForTest.isConnected);
  assert.equal(await page.evaluate(() => document.getElementById('redator-groq-console') === window.replacementHubForTest), true,
    'the previous exit animation must not remove the replacement hub');
  await openPane(page, 'genre');
  await control(page, 'choice-level-5').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'summary-genre').innerText(), LEVELS[4]);
  assert.equal(await control(page, 'generate').isEnabled(), true);
});

test('keeps the result pane closed when generation completes during animated collapse', async t => {
  const { page } = await mount(t, { reducedMotion: 'no-preference', content: '' });
  await page.evaluate(payload => {
    window.fetch = () => new Promise(resolve => {
      window.completeGenerationForTest = () => resolve(new Response(JSON.stringify(payload), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    });
    const root = document.getElementById('redator-groq-console').shadowRoot;
    root.getElementById('generate').click();
    root.getElementById('minimize').click();
    window.completeGenerationForTest();
  }, completion());
  await ready(page);
  await control(page, 'panel-body').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'result').inputValue(), ESSAY, 'the generated essay remains available for later review');
  assert.equal(await control(page, 'minimize').getAttribute('aria-expanded'), 'false');
  assert.equal(await control(page, 'secondary-panel').isVisible(), false,
    'completion during the collapse animation must preserve the user’s minimized state');
});

test('keeps the compact hub, panes and top-right notifications inside 320px and 390px viewports', async t => {
  for (const width of [320, 390]) {
    const { page } = await mount(t, { viewport: { width, height: 844 } });
    const main = await control(page, 'main-panel').boundingBox();
    assert.equal(main.width, 284);
    assert.ok(main.x >= 0 && main.x + main.width <= width, `main hub must fit ${width}px`);
    assert.ok(main.height < 370, `hub must stay compact at ${width}px: ${main.height}px`);
    await openPane(page, 'genre');
    const pane = await control(page, 'secondary-panel').boundingBox();
    assert.ok(pane.x >= 0 && pane.x + pane.width <= width, `options must fit ${width}px`);
    assert.equal(await control(page, 'main-panel').isVisible(), false);
    await control(page, 'choice-level-5').click();
    await generate(page);
    const stack = await control(page, 'notifications').boundingBox();
    const resultPane = await control(page, 'secondary-panel').boundingBox();
    assert.ok(stack.y >= 0 && stack.y + stack.height < 844 / 2,
      `the scrolling notification stack must stay near the top: ${JSON.stringify(stack)}`);
    assert.ok(stack.y + stack.height <= resultPane.y,
      `mobile notifications must leave the options header reachable at ${width}px: ${JSON.stringify({ stack, resultPane })}`);
    const boxes = await notifications(page).evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, right: rect.right, bottom: rect.bottom,
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
    }));
    assert.ok(boxes.length >= 2);
    for (const box of boxes) {
      assert.ok(box.x >= 0 && box.right <= width, `notification must fit ${width}px: ${JSON.stringify(box)}`);
      assert.ok(box.scrollWidth <= box.clientWidth + 1, 'notification copy must wrap without horizontal overflow');
    }
    const latest = boxes.at(-1);
    assert.ok(latest.y >= stack.y && latest.bottom <= stack.y + stack.height + 1,
      `the newest autofill notification must be fully visible within the scrolling stack: ${JSON.stringify({ stack, latest })}`);
    await closePane(page);
    assert.equal(await control(page, 'main-panel').isVisible(), true);
  }
});
