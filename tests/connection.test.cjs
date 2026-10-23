const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test:nodeTest, before, after } = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIXTURE_ORIGIN = 'http://fixture.redator.test';
const OTHER_ORIGIN = 'https://other.redator.test';
const SERVICE_ORIGIN = 'https://redacao-maker.vercel.app';
const API_URL = `${SERVICE_ORIGIN}/api/generate`;
const CHANNEL = 'connection-test-channel-1234567890';
const FIXTURE = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Referência</title></head><body><main><h1>Bibliotecas e inclusão digital</h1><p>Bibliotecas públicas oferecem acesso à internet e à educação.</p></main><button id="open-relay">Abrir conexão</button></body></html>';
const INPUT = {
  context:'Bibliotecas públicas oferecem acesso gratuito à internet e formação digital.',
  theme:'Inclusão digital e cidadania', level:3, words:350,
  instructions:'Explique o papel das bibliotecas públicas.'
};
const test = (name, run) => nodeTest(name, { timeout:20000 }, run);

let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless:true, args:['--no-sandbox', '--disable-dev-shm-usage']
  });
});
after(async () => { await browser?.close(); });

function completion(content) {
  return { choices:[{ message:{ role:'assistant', content }, finish_reason:'stop' }] };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function control(page, id) {
  return page.locator(`#redator-batata-console >> #${id}`);
}

async function fixture(t, options = {}) {
  const context = await browser.newContext({ reducedMotion:'reduce' });
  context.setDefaultTimeout(5000);
  t.after(() => context.close());
  const requests = [];
  const hubLoads = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if ([FIXTURE_ORIGIN, OTHER_ORIGIN].includes(url.origin)) {
      return route.fulfill({ status:200, contentType:'text/html', body:FIXTURE,
        headers:{ 'content-security-policy':`default-src 'none'; connect-src ${options.allowExternal ? "*" : "'self'"}; style-src 'unsafe-inline'` } });
    }
    if (request.url() === API_URL) {
      requests.push(request);
      if (options.api) return options.api(route, requests.length);
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(completion('Resultado recebido pela janela auxiliar.')) });
    }
    if (url.origin === SERVICE_ORIGIN && ['/connection.html', '/connection.js', '/hub.js'].includes(url.pathname)) {
      if (url.pathname === '/hub.js') hubLoads.push(request.url());
      const filename = url.pathname === '/hub.js' ? 'redator-batata.js' : `public${url.pathname}`;
      return route.fulfill({ status:200,
        contentType:url.pathname.endsWith('.html') ? 'text/html' : 'application/javascript',
        body:fs.readFileSync(path.join(ROOT, filename), 'utf8') });
    }
    if (url.origin === SERVICE_ORIGIN && url.pathname === '/spoof.html') {
      return route.fulfill({ status:200, contentType:'text/html', body:'<!doctype html><title>Outra janela</title>' });
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${FIXTURE_ORIGIN}/`);
  await page.evaluate(() => {
    window.__openCalls = [];
    window.__directInputs = [];
    window.__messages = [];
    window.__nativeOpen = window.open.bind(window);
    window.open = (...args) => {
      window.__openCalls.push({ url:String(args[0]), active:navigator.userActivation.isActive });
      window.__relay = window.__nativeOpen(...args);
      return window.__relay;
    };
    const fetch = window.fetch.bind(window);
    window.fetch = (url, init) => {
      if (String(url).endsWith('/api/generate')) window.__directInputs.push(JSON.parse(init.body));
      return fetch(url, init);
    };
    window.addEventListener('message', event => window.__messages.push({
      data:event.data, origin:event.origin, fromRelay:event.source === window.__relay
    }));
  });
  if (options.ignoreReady) {
    await page.evaluate(() => window.addEventListener('message', event => {
      if (event.data?.type === 'redator-batata:ready') event.stopImmediatePropagation();
    }, true));
  }
  if (options.hub !== false) {
    // DevTools evaluation installs the console snippet; browser CSP still applies to its fetch.
    await page.evaluate(fs.readFileSync(path.join(ROOT, 'redator-batata.js'), 'utf8'));
    await page.locator('#redator-batata-console').waitFor();
  }
  return { context, page, requests, hubLoads };
}

async function configure(page) {
  if (!await control(page, 'pane-source').isVisible()) await control(page, 'open-source').click();
  await control(page, 'context').fill(INPUT.context);
  await control(page, 'save-source').click();
  await control(page, 'secondary-panel').waitFor({ state:'hidden' });
  if (!await control(page, 'pane-writing').isVisible()) await control(page, 'open-writing').click();
  await control(page, 'theme').fill(INPUT.theme);
  await control(page, 'instructions').fill(INPUT.instructions);
  await control(page, 'save-writing').click();
  await control(page, 'secondary-panel').waitFor({ state:'hidden' });
}

async function ready(page) {
  await page.waitForFunction(() => !document.getElementById('redator-batata-console')?.shadowRoot?.getElementById('generate').disabled);
}

async function blockedGeneration(page) {
  await configure(page);
  await control(page, 'generate').click();
  await control(page, 'retry-connection').waitFor({ state:'visible' });
  await ready(page);
}

async function startFallback(page) {
  const opened = page.waitForEvent('popup');
  await control(page, 'retry-connection').click();
  return opened;
}

async function popupClosed(popup) {
  if (!popup.isClosed()) await popup.waitForEvent('close');
}

async function flushMessages(page) {
  // Run two posted tasks so message handlers have had a chance to reject invalid input.
  await page.evaluate(() => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  }));
}

async function openRelay(page) {
  const relayURL = `${SERVICE_ORIGIN}/connection.html#${new URLSearchParams({ channel:CHANNEL, origin:FIXTURE_ORIGIN })}`;
  await page.evaluate(url => {
    document.getElementById('open-relay').onclick = () => { window.__relay = window.open(url, 'relay-under-test'); };
  }, relayURL);
  const opened = page.waitForEvent('popup');
  await page.locator('#open-relay').click();
  const popup = await opened;
  await popup.locator('#connection-status').waitFor();
  await page.waitForFunction(channel => window.__messages.some(event => event.data.type === 'redator-batata:ready' && event.data.channel === channel), CHANNEL);
  return popup;
}

test('CSP-blocked fetch offers an explicit auxiliary window and returns the same input to the original hub', async t => {
  const { context, page, requests } = await fixture(t);
  await blockedGeneration(page);
  await control(page, 'status').filter({ hasText:/CSP|política|bloqueia conexões/i }).waitFor();
  assert.match(await control(page, 'status').textContent(), /CSP|política|bloqueia conexões/i);
  assert.equal(await control(page, 'retry-connection').textContent(), 'Gerar em janela auxiliar');
  assert.equal(await control(page, 'connection-help').getAttribute('href'), `${SERVICE_ORIGIN}/connection.html`);
  await flushMessages(page);
  assert.equal(requests.length, 0, 'CSP must block the actual cross-origin fetch');
  assert.equal(context.pages().length, 1, 'a failed request must not open a popup automatically');
  assert.equal((await page.evaluate(() => window.__openCalls)).length, 0);
  const popup = await startFallback(page);
  await popupClosed(popup);
  await ready(page);
  assert.equal(await control(page, 'result').inputValue(), 'Resultado recebido pela janela auxiliar.');
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].frame().url()).origin, SERVICE_ORIGIN);
  assert.deepEqual(requests[0].postDataJSON(), INPUT);
  assert.deepEqual(await page.evaluate(() => window.__directInputs), [INPUT]);
  const [opened] = await page.evaluate(() => window.__openCalls);
  assert.equal(opened.active, true, 'window.open must run within the explicit click');
  const hash = new URLSearchParams(new URL(opened.url).hash.slice(1));
  assert.equal(hash.get('origin'), FIXTURE_ORIGIN);
  assert.match(hash.get('channel'), /^[A-Za-z0-9_-]{22,128}$/);
  assert.equal(requests[0].headers().authorization, undefined);
  assert.equal(requests[0].headers()['x-api-key'], undefined);

  await control(page, 'secondary-close').click();
  await control(page, 'secondary-panel').waitFor({ state:'hidden' });
  const nextPopup = page.waitForEvent('popup');
  await control(page, 'generate').click();
  const next = await nextPopup;
  await popupClosed(next);
  await ready(page);
  assert.equal(requests.length, 2, 'choosing the window should keep later attempts on the working transport');
  assert.deepEqual(await page.evaluate(() => window.__directInputs), [INPUT]);
});

test('parent rejects a response from another source, a wrong channel, and a navigated popup origin', async t => {
  const received = deferred();
  const release = deferred();
  const { page } = await fixture(t, { api:async route => {
    received.resolve();
    await release.promise;
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(completion('Resposta tardia.')) }).catch(() => {});
  } });
  t.after(() => release.resolve());
  await blockedGeneration(page);
  const popup = await startFallback(page);
  await received.promise;
  const channel = new URLSearchParams(new URL(popup.url()).hash.slice(1)).get('channel');
  const forged = { type:'redator-batata:response', channel, status:200, body:JSON.stringify(completion('RESULTADO_FALSO')), retryAfter:'' };
  await popup.evaluate(message => window.opener.postMessage({ ...message, channel:'canal-incorreto' }, '*'), forged);
  const rogueOpened = page.waitForEvent('popup');
  await page.evaluate(url => window.__nativeOpen(url, '_blank'), `${SERVICE_ORIGIN}/spoof.html`);
  const rogue = await rogueOpened;
  await rogue.waitForLoadState();
  await rogue.evaluate(message => window.opener.postMessage(message, '*'), forged);
  await flushMessages(page);
  assert.equal(await control(page, 'result').inputValue(), '');
  assert.equal(await control(page, 'generate').isDisabled(), true);
  await popup.evaluate(url => { window.location.href = url; }, `${OTHER_ORIGIN}/`);
  await popup.waitForURL(`${OTHER_ORIGIN}/`);
  await popup.evaluate(message => {
    window.addEventListener('message', event => event.source.postMessage(message, '*'), { once:true });
  }, forged);
  await page.evaluate(() => window.__relay.postMessage({ trigger:'forge' }, '*'));
  await page.waitForFunction(origin => window.__messages.some(event => event.origin === origin && event.data.type === 'redator-batata:response'), OTHER_ORIGIN);
  await flushMessages(page);
  assert.equal(await control(page, 'result').inputValue(), '');
  assert.equal(await control(page, 'generate').isDisabled(), true, 'the same WindowProxy at another origin must remain untrusted');
  await control(page, 'cancel').click();
  await ready(page);
  await popupClosed(popup);
  assert.equal(popup.isClosed(), true);
  await rogue.close();
});

test('cancelling an auxiliary generation closes the popup and ignores its late result', async t => {
  const received = deferred();
  const release = deferred();
  const { page, requests } = await fixture(t, { api:async (route, count) => {
    if (count === 1) { received.resolve(); await release.promise; }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(completion(count === 1 ? 'RESULTADO_CANCELADO' : 'Nova geração concluída.')) }).catch(() => {});
  } });
  t.after(() => release.resolve());
  await blockedGeneration(page);
  const popup = await startFallback(page);
  await received.promise;
  const closed = popup.waitForEvent('close');
  await control(page, 'cancel').click();
  await closed;
  await ready(page);
  assert.match(await control(page, 'status').textContent(), /cancelad|interrompid/i);
  release.resolve();
  await flushMessages(page);
  assert.equal(await control(page, 'result').inputValue(), '');
  assert.equal(await control(page, 'context').inputValue(), INPUT.context);
  const opened = page.waitForEvent('popup');
  await control(page, 'generate').click();
  const next = await opened;
  await popupClosed(next);
  await ready(page);
  assert.equal(requests.length, 2);
  assert.equal(await control(page, 'result').inputValue(), 'Nova geração concluída.');
});

test('a blocked popup keeps the draft and provides a manual link and a working retry', async t => {
  const { page, requests } = await fixture(t);
  await blockedGeneration(page);
  await page.evaluate(() => { window.__workingOpen = window.open; window.open = () => null; });
  await control(page, 'retry-connection').click();
  await ready(page);
  assert.match(await control(page, 'status').textContent(), /bloqueou|pop-ups|permita|link/i);
  assert.equal(await control(page, 'connection-help').isVisible(), true);
  assert.equal(await control(page, 'context').inputValue(), INPUT.context);
  assert.equal(await control(page, 'theme').inputValue(), INPUT.theme);
  assert.equal(await control(page, 'instructions').inputValue(), INPUT.instructions);
  assert.equal(requests.length, 0);
  await page.evaluate(() => { window.open = window.__workingOpen; });
  const popup = await startFallback(page);
  await popupClosed(popup);
  await ready(page);
  assert.equal(await control(page, 'result').inputValue(), 'Resultado recebido pela janela auxiliar.');
  assert.deepEqual(requests[0].postDataJSON(), INPUT);
});

test('relay pins its opener, origin and channel and accepts only one generation', async t => {
  const received = deferred();
  const release = deferred();
  const { page, requests } = await fixture(t, { hub:false, api:async route => {
    received.resolve();
    await release.promise;
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'retry-after':'7' }, body:JSON.stringify(completion('Resposta única.')) });
  } });
  t.after(() => release.resolve());
  const popup = await openRelay(page);
  const message = { type:'redator-batata:generate', channel:CHANNEL, input:INPUT };
  await page.evaluate(data => window.__relay.postMessage({ ...data, channel:'outro-canal' }, '*'), message);
  const rogueOpened = popup.waitForEvent('popup');
  await popup.evaluate(url => window.open(url, '_blank'), `${SERVICE_ORIGIN}/spoof.html`);
  const rogue = await rogueOpened;
  await rogue.waitForLoadState();
  await rogue.evaluate(data => window.opener.postMessage(data, '*'), message);
  await flushMessages(popup);
  assert.equal(requests.length, 0, 'wrong source and wrong channel must not issue any POST');
  // Isolate origin validation while retaining the pinned opener identity. The parent
  // test above also exercises an actual cross-origin popup navigation and message.
  await popup.evaluate(({ data, origin }) => window.dispatchEvent(new MessageEvent('message', {
    data, origin, source:window.opener
  })), { data:message, origin:OTHER_ORIGIN });
  await flushMessages(popup);
  assert.equal(requests.length, 0, 'the right source with a wrong origin must not be authorized');
  await page.evaluate(data => {
    window.__relay.postMessage(data, '*');
    window.__relay.postMessage(data, '*');
  }, message);
  await received.promise;
  await flushMessages(popup);
  assert.equal(requests.length, 1, 'duplicate ready/generate traffic must not duplicate a POST');
  assert.deepEqual(requests[0].postDataJSON(), INPUT);
  assert.equal(new URL(requests[0].frame().url()).origin, SERVICE_ORIGIN);
  release.resolve();
  await page.waitForFunction(() => window.__messages.some(event => event.data.type === 'redator-batata:response'));
  const responses = await page.evaluate(() => window.__messages.filter(event => event.data.type === 'redator-batata:response'));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].origin, SERVICE_ORIGIN);
  assert.equal(responses[0].data.channel, CHANNEL);
  assert.equal(responses[0].data.status, 200);
  assert.equal(responses[0].data.retryAfter, '7');
  assert.deepEqual(JSON.parse(responses[0].data.body), completion('Resposta única.'));
  await page.evaluate(data => window.__relay.postMessage(data, '*'), message);
  await flushMessages(popup);
  assert.equal(requests.length, 1, 'the completed relay must also reject later generations');
  await rogue.close();
});

test('a standalone connection page opens its own hub only after the manual action', async t => {
  const { context, hubLoads, requests } = await fixture(t, { hub:false });
  const standalone = await context.newPage();
  await standalone.goto(`${SERVICE_ORIGIN}/connection.html`);
  assert.match(await standalone.locator('#connection-status').textContent(), /cole|referência/i);
  assert.equal(await standalone.locator('#redator-batata-console').count(), 0);
  assert.equal(hubLoads.length, 0);
  assert.equal(requests.length, 0);
  await standalone.locator('#manual-open').click();
  await standalone.locator('#redator-batata-console').waitFor();
  assert.equal(await control(standalone, 'context').inputValue(), '', 'relay instructions must not become a source draft');
  assert.equal(hubLoads.length, 1);
  assert.match(await standalone.locator('#connection-status').textContent(), /cole.*referência|hub aberto/i);
  await configure(standalone);
  await control(standalone, 'generate').click();
  await ready(standalone);
  assert.equal(await control(standalone, 'result').inputValue(), 'Resultado recebido pela janela auxiliar.');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].postDataJSON(), INPUT);
});

test('manual handoff detaches the parent without closing the auxiliary hub or its draft', async t => {
  const { page, requests } = await fixture(t, { ignoreReady:true });
  await blockedGeneration(page);
  await page.clock.install();
  const popup = await startFallback(page);
  await popup.locator('#manual-open').click();
  await control(popup, 'context').waitFor();
  await ready(page);
  assert.match(await control(page, 'status').textContent(), /janela auxiliar|referência/i);
  assert.equal(popup.isClosed(), false);
  await control(popup, 'context').fill('RASCUNHO_MANUAL_PRESERVADO');
  await page.clock.fastForward(13000);
  assert.equal(popup.isClosed(), false, 'the old handshake timer must not close a detached manual hub');
  assert.equal(await control(popup, 'context').inputValue(), 'RASCUNHO_MANUAL_PRESERVADO');
  assert.equal(requests.length, 0);
});

test('handshake timeout leaves the auxiliary window available for manual generation', async t => {
  const { page, requests } = await fixture(t, { ignoreReady:true });
  await blockedGeneration(page);
  await page.clock.install();
  const popup = await startFallback(page);
  await popup.locator('#manual-open').waitFor();
  await page.clock.fastForward(13000);
  await ready(page);
  assert.match(await control(page, 'status').textContent(), /impediu|referência|janela aberta/i);
  assert.equal(popup.isClosed(), false, 'a failed handshake should preserve the manual recovery window');
  await popup.locator('#manual-open').click();
  await control(popup, 'context').waitFor();
  await control(popup, 'context').fill('Referência colada depois da falha de conexão.');
  assert.equal(await control(popup, 'context').inputValue(), 'Referência colada depois da falha de conexão.');
  assert.equal(requests.length, 0);
});

test('an ordinary network failure offers the same explicit fallback without claiming a CSP violation', async t => {
  const { page, requests } = await fixture(t, { allowExternal:true, api:route => route.abort('failed') });
  await blockedGeneration(page);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(await control(page, 'status').textContent(), /CSP|política/i);
  assert.match(await control(page, 'status').textContent(), /conexão|internet/i);
  assert.equal(await control(page, 'connection-help').isVisible(), true);
  assert.equal((await page.evaluate(() => window.__openCalls)).length, 0);
});
