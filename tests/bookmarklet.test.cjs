'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const PUBLIC_ORIGIN = 'https://redacao-maker.vercel.app';
const ARTICLE_URL = 'https://fixture.redator.test/artigo?tema=inclusao#referencia';
const publicDirectory = path.join(__dirname, '..', 'public');
const article = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Página de referência</title></head>
<body><main id="existing-content"><h1>A inclusão digital no Brasil</h1>
<p id="selection-target">Bibliotecas públicas oferecem internet gratuita e oportunidades de estudo.</p>
<p>O custo da conexão ainda impede o acesso de parte da população.</p>
<form><label>SEGREDO_FORMULARIO<input type="password" value="SEGREDO_SENHA"></label></form>
</main></body></html>`;

let browser;
let installation;
let hubScript;
let fullScript;
let bookmarkText;
let bookmarkImport;

before(async () => {
  installation = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
  hubScript = fs.readFileSync(path.join(publicDirectory, 'hub.js'), 'utf8');
  fullScript = fs.readFileSync(path.join(publicDirectory, 'redator-batata.js'), 'utf8');
  bookmarkText = fs.readFileSync(path.join(publicDirectory, 'bookmarklet.txt'), 'utf8').trim();
  bookmarkImport = fs.readFileSync(path.join(publicDirectory, 'favorito-batata.html'), 'utf8');
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});

after(async () => { await browser?.close(); });

function corsHeaders() {
  return { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS' };
}

async function mount(t, clipboard = 'success') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const unexpectedRequests = [];
  const hubRequests = [];
  const backendRequests = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(unexpectedRequests, [], 'all network requests must use the local public fixtures');
  });
  await context.addInitScript(mode => {
    window.copiedForTest = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async value => {
        if (mode === 'denied') throw new DOMException('Clipboard denied', 'NotAllowedError');
        window.copiedForTest.push(value);
      },
    } });
  }, clipboard);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    for (const header of ['authorization', 'x-api-key', 'api-key', 'x-access-token', 'x-hub-token']) {
      assert.equal(request.headers()[header], undefined, `public installation must not send ${header}`);
    }
    if (url.origin === PUBLIC_ORIGIN) {
      if (url.pathname === '/') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: installation });
      }
      if (url.pathname === '/hub.js') {
        hubRequests.push(request.url());
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: hubScript });
      }
      if (url.pathname === '/redator-batata.js') {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: fullScript });
      }
      if (url.pathname === '/bookmarklet.txt') {
        return route.fulfill({ status: 200, contentType: 'text/plain', body: bookmarkText });
      }
      if (url.pathname === '/favorito-batata.html') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: bookmarkImport });
      }
      if (url.pathname === '/api/health') {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(),
          body: JSON.stringify({ service: 'batata', configured: true, publicAccess: true }) });
      }
      if (url.pathname === '/api/generate') {
        if (request.method() === 'OPTIONS') {
          return route.fulfill({ status: 204, headers: corsHeaders() });
        }
        backendRequests.push(request.postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(),
          body: JSON.stringify({ choices: [{ message: { content: 'Uma redação pública de teste.' }, finish_reason: 'stop' }] }) });
      }
    }
    if (request.url() === ARTICLE_URL.replace('#referencia', '')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: article });
    }
    unexpectedRequests.push(request.url());
    return route.abort();
  });
  await page.goto(`${PUBLIC_ORIGIN}/`);
  await page.locator('#bookmarklet').waitFor();
  await page.waitForFunction(() => document.querySelector('#health-status')?.dataset.state === 'ready');
  return { page, hubRequests, backendRequests };
}

function assertPublicBookmarklet(href) {
  assert.match(href, /^javascript:/i, 'the full bookmark URL must retain its javascript: prefix');
  const source = decodeURIComponent(href.slice('javascript:'.length));
  assert.ok(source.includes(`${PUBLIC_ORIGIN}/hub.js`), 'the bookmark must load the canonical public hub');
  assert.doesNotMatch(source, /gsk_|Bearer\s|(?:BATATA|GROQ)_API_KEY|authorization|password|x-api-key/i);
}

function control(page, id) {
  return page.locator(`#redator-batata-console >> #${id}`);
}

async function activateBookmarklet(page, href) {
  // Assignment uses the browser's JavaScript-URL behavior on the current document.
  // page.goto() intentionally does not support javascript: URLs.
  await page.evaluate(value => { window.location.href = value; }, href);
  await page.locator('#redator-batata-console').waitFor();
  await page.waitForFunction(() => ![...document.scripts].some(script => {
    if (!script.src) return false;
    const url = new URL(script.src);
    return url.origin === 'https://redacao-maker.vercel.app' && url.pathname === '/hub.js';
  }));
}

test('offers a public JavaScript bookmark with bookmark-bar installation as the primary flow', async t => {
  const { page, backendRequests } = await mount(t);
  assert.equal(await page.title(), 'Redator Batata · bookmarklet');
  assert.equal(await page.locator('header .brand').textContent(), 'Redator');
  assert.equal(await page.locator('header .badge').textContent(), 'BATATA');
  assert.equal(await page.locator('#bookmarklet').textContent(), '★ Redator Batata');
  const href = await page.locator('#bookmarklet').getAttribute('href');
  assertPublicBookmarklet(href);
  const steps = await page.locator('main ol').first().innerText();
  assert.match(steps, /arrast/i);
  assert.match(steps, /barra de favoritos/i);
  assert.doesNotMatch(steps, /F12|Console/i);
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  assert.deepEqual(backendRequests, []);
});

test('copies the exact full bookmark URL through the clipboard', async t => {
  const { page } = await mount(t);
  const href = await page.locator('#bookmarklet').getAttribute('href');
  await page.locator('#copy-bookmarklet').click();
  await page.waitForFunction(() => window.copiedForTest.length === 1);
  assert.deepEqual(await page.evaluate(() => window.copiedForTest), [href]);
  assertPublicBookmarklet(href);
  assert.match(await page.locator('#copy-status').innerText(), /favorit/i);
  assert.equal(await page.locator('#manual-script').isVisible(), false);
});

test('clipboard rejection selects the full bookmark URL and explains where to save it', async t => {
  const { page } = await mount(t, 'denied');
  const href = await page.locator('#bookmarklet').getAttribute('href');
  await page.locator('#copy-bookmarklet').click();
  await page.locator('#manual-script').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#manual-script').inputValue(), href);
  assertPublicBookmarklet(await page.locator('#manual-script').inputValue());
  const instructions = `${await page.locator('#manual-label').innerText()} ${await page.locator('#copy-status').innerText()}`;
  assert.match(instructions, /favorit/i);
  assert.match(instructions, /URL|endere[cç]o/i);
  assert.doesNotMatch(instructions, /barra de endere[cç]os|Console/i);
  assert.deepEqual(await page.locator('#manual-script').evaluate(node => ({
    focused: document.activeElement === node,
    selection: node.value.slice(node.selectionStart, node.selectionEnd),
  })), { focused: true, selection: href });
});

test('executes on an existing page, removes its loader, and keeps one hub on repeated use', async t => {
  const { page, hubRequests, backendRequests } = await mount(t);
  const href = await page.locator('#bookmarklet').getAttribute('href');
  await page.goto(ARTICLE_URL);
  const originalContent = await page.locator('#existing-content').innerHTML();
  await activateBookmarklet(page, href);
  assert.equal(page.url(), ARTICLE_URL);
  assert.equal(await page.locator('#existing-content').innerHTML(), originalContent);
  assert.equal(hubRequests.length, 1);
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
  assert.equal(await page.locator('#redator-batata-console >> input[type="password"]').count(), 0);
  assert.doesNotMatch(await control(page, 'context').inputValue(), /SEGREDO_/);
  assert.match(await control(page, 'context').inputValue(), /Bibliotecas públicas/);
  await control(page, 'open-source').click();
  const draft = 'Uma referência revisada que deve sobreviver ao segundo clique no favorito.';
  await control(page, 'context').fill(draft);
  await activateBookmarklet(page, href);
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
  assert.equal(await control(page, 'context').inputValue(), draft);
  assert.equal(page.url(), ARTICLE_URL);
  assert.deepEqual(backendRequests, [], 'opening the bookmark must not generate an essay');
});

test('keeps an existing text selection as the initial context while loading the hub', async t => {
  const { page } = await mount(t);
  const href = await page.locator('#bookmarklet').getAttribute('href');
  await page.goto(ARTICLE_URL);
  const expected = await page.locator('#selection-target').innerText();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('selection-target'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await activateBookmarklet(page, href);
  assert.equal(await control(page, 'context').inputValue(), expected);
  assert.match(await control(page, 'summary-source').innerText(), /sele[cç][aã]o/i);
});

test('publishes matching text and Netscape import artifacts whose bookmark actually runs', async t => {
  const { page } = await mount(t);
  const href = await page.locator('#bookmarklet').getAttribute('href');
  assert.equal(bookmarkText, href);
  assertPublicBookmarklet(bookmarkText);
  assert.match(bookmarkImport, /<!DOCTYPE NETSCAPE-Bookmark-file-1>/i);
  assert.match(bookmarkImport, /<DL\b/i);
  assert.match(bookmarkImport, /<DT>\s*<A\b/i);
  await page.goto(`${PUBLIC_ORIGIN}/favorito-batata.html`);
  assert.equal(await page.title(), 'Redator Batata');
  assert.equal(await page.locator('h1').textContent(), 'Redator Batata');
  const imported = page.locator('a[href^="javascript:"]');
  assert.equal(await imported.count(), 1);
  assert.equal(await imported.textContent(), 'Redator Batata');
  const importedHref = await imported.getAttribute('href');
  assert.equal(importedHref, href, 'HTML attribute escaping must preserve the complete JavaScript URL');
  await page.goto(ARTICLE_URL);
  await activateBookmarklet(page, importedHref);
  assert.equal(page.url(), ARTICLE_URL);
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
});

test('keeps both advanced console copy options working', async t => {
  const { page } = await mount(t);
  const advanced = page.locator('#copy-loader').locator('xpath=ancestor::details');
  if (await advanced.count()) await advanced.evaluate(node => { node.open = true; });
  await page.locator('#copy-loader').click();
  await page.waitForFunction(() => window.copiedForTest.length === 1);
  const loader = (await page.evaluate(() => window.copiedForTest))[0];
  assert.ok(loader.includes(`${PUBLIC_ORIGIN}/hub.js`));
  assert.doesNotMatch(loader, /^javascript:/i);
  await page.locator('#copy-script').click();
  await page.waitForFunction(() => window.copiedForTest.length === 2);
  assert.equal((await page.evaluate(() => window.copiedForTest))[1], fullScript);
});
