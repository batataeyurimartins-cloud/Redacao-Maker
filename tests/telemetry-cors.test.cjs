'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const PUBLIC_ORIGIN = 'https://redacao-maker.vercel.app';
const PROVIDER_URL = 'https://api.groq.com/openai/v1/chat/completions';
const FIXTURE_KEY = 'gsk_CORS_BROWSER_FIXTURE_ONLY';
const RESULT = 'Bibliotecas públicas ampliam o acesso à educação e à cidadania digital.';
const TELEMETRY_HEADERS = {
  'Request-Id': '|0123456789abcdef.0123456789abcdef.',
  'Request-Context': 'appId=cid-v1:00000000-0000-0000-0000-000000000000',
  Traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
  Tracestate: 'redator=fixture',
  Baggage: 'fixture=saladofuturo'
};
const INPUT = {
  context: 'Bibliotecas públicas oferecem acesso gratuito à internet e formação digital.',
  theme: 'Inclusão digital e cidadania', genre: 'enem', words: 500,
  instructions: 'Explique o papel das bibliotecas públicas.', model: 'openai/gpt-oss-120b'
};
const EXPECTED_HEADERS = ['content-type', ...Object.keys(TELEMETRY_HEADERS).map(name => name.toLowerCase())].sort();

let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
});
after(async () => { await browser?.close(); });

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

function headerNames(value = '') {
  return value.split(',').map(name => name.trim().toLowerCase()).filter(Boolean).sort();
}

function control(page, id) {
  return page.locator(`#redator-groq-console >> #${id}`);
}

async function fixture(t, extraHeaders = {}) {
  const providerCalls = [];
  const apiRequests = [];
  const serverErrors = [];
  const browserRequests = [];
  const previousFetch = global.fetch;
  const previousEnv = Object.fromEntries(['GROQ_API_KEY', 'GROQ_MODEL', 'VERCEL'].map(key => [key, process.env[key]]));
  let context;
  const apiServer = http.createServer(async (req, res) => {
    if (req.url !== '/api/generate') { res.writeHead(404).end(); return; }
    const entry = { method: req.method, headers: { ...req.headers }, providerCallsBefore: providerCalls.length };
    apiRequests.push(entry);
    try {
      // Mirror Vercel's parsed-body interface, while using real HTTP and the actual handler.
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        req.body = Buffer.concat(chunks).toString('utf8');
        entry.body = JSON.parse(req.body);
      }
      await generate(req, res);
      entry.status = res.statusCode;
      entry.responseHeaders = res.getHeaders();
      entry.providerCallsAfter = providerCalls.length;
    } catch (error) {
      serverErrors.push(error.message);
      if (!res.writableEnded) res.writeHead(500).end();
    }
  });
  const pageServer = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(204).end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; connect-src ${apiOrigin}`
    });
    res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Sala de referência</title><main><h1>Inclusão digital</h1><p>Bibliotecas públicas oferecem internet e oportunidades de estudo.</p></main></html>');
  });
  t.after(async () => {
    await context?.close();
    await Promise.all([close(apiServer), close(pageServer)]);
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.deepEqual(serverErrors, []);
  });
  process.env.GROQ_API_KEY = FIXTURE_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.VERCEL;
  delete require.cache[require.resolve('../api/generate.js')];
  const generate = require('../api/generate.js');
  // This stub affects Node only; Chromium still performs its own real CORS preflight.
  global.fetch = async (url, options) => {
    providerCalls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      model: INPUT.model,
      choices: [{ message: { role: 'assistant', content: RESULT }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const apiOrigin = await listen(apiServer);
  const pageOrigin = await listen(pageServer);
  context = await browser.newContext({ serviceWorkers: 'block' });
  context.setDefaultTimeout(5000);
  context.on('request', request => browserRequests.push({ url: request.url(), headers: request.headers() }));
  const page = await context.newPage();
  await page.goto(pageOrigin);
  await page.evaluate(({ apiOrigin, headers }) => {
    const nativeFetch = window.fetch.bind(window);
    const nativeOpen = window.open.bind(window);
    window.__generationInputs = [];
    window.__openCalls = [];
    window.open = (...args) => { window.__openCalls.push(String(args[0])); return nativeOpen(...args); };
    // Reproduce the host page's Application Insights correlation-header injection.
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === apiOrigin) {
        const combined = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        for (const [name, value] of Object.entries(headers)) combined.set(name, value);
        window.__generationInputs.push(JSON.parse(init.body));
        return nativeFetch(input, { ...init, headers: combined });
      }
      return nativeFetch(input, init);
    };
  }, { apiOrigin, headers: { ...TELEMETRY_HEADERS, ...extraHeaders } });
  const source = fs.readFileSync(path.join(__dirname, '..', 'redator-groq.js'), 'utf8');
  const serviceDeclaration = `const SERVICE_ORIGIN = '${PUBLIC_ORIGIN}';`;
  assert.ok(source.includes(serviceDeclaration), 'the fixture must replace the actual service origin');
  await page.evaluate(source.replace(serviceDeclaration, `const SERVICE_ORIGIN = '${apiOrigin}';`));
  await page.locator('#redator-groq-console').waitFor();
  t.after(() => {
    assert.ok(browserRequests.every(request => [pageOrigin, apiOrigin].includes(new URL(request.url).origin)),
      'the regression must not make internet requests');
    assert.ok(browserRequests.every(request => request.headers.authorization === undefined),
      'the browser must not send provider credentials');
  });
  return { page, context, apiOrigin, pageOrigin, apiRequests, providerCalls };
}

async function configure(page) {
  await control(page, 'open-source').click();
  await control(page, 'context').fill(INPUT.context);
  await control(page, 'save-source').click();
  await control(page, 'open-writing').click();
  await control(page, 'theme').fill(INPUT.theme);
  await control(page, 'instructions').fill(INPUT.instructions);
  await control(page, 'save-writing').click();
  await control(page, 'open-genre').click();
  await control(page, `choice-genre-${INPUT.genre}`).click();
  await control(page, 'open-words').click();
  await control(page, `choice-words-${INPUT.words}`).click();
  await control(page, 'open-connection').click();
  await control(page, 'model').fill(INPUT.model);
  await control(page, 'save-connection').click();
}

test('real cross-origin telemetry preflight permits one POST and displays the result without a popup', { timeout: 20000 }, async t => {
  const { page, context, pageOrigin, apiRequests, providerCalls } = await fixture(t);
  await configure(page);
  await control(page, 'generate').click();
  await page.waitForFunction(() => document.getElementById('redator-groq-console').shadowRoot.getElementById('result').value.length > 0);

  assert.equal(await control(page, 'result').inputValue(), RESULT);
  assert.equal(await control(page, 'retry-connection').isVisible(), false);
  assert.equal(context.pages().length, 1);
  assert.deepEqual(await page.evaluate(() => window.__openCalls), []);
  assert.deepEqual(await page.evaluate(() => window.__generationInputs), [INPUT]);
  assert.deepEqual(apiRequests.map(request => request.method), ['OPTIONS', 'POST']);
  const [preflight, post] = apiRequests;
  assert.equal(preflight.headers.origin, pageOrigin);
  assert.equal(preflight.headers['access-control-request-method'], 'POST');
  assert.deepEqual(headerNames(preflight.headers['access-control-request-headers']), EXPECTED_HEADERS);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.providerCallsBefore, 0);
  assert.equal(preflight.providerCallsAfter, 0, 'OPTIONS must never invoke Groq');
  assert.deepEqual(headerNames(preflight.responseHeaders['access-control-allow-headers']), EXPECTED_HEADERS);
  assert.equal(preflight.responseHeaders['access-control-allow-credentials'], undefined);
  assert.deepEqual(post.body, INPUT);
  assert.equal(post.status, 200);
  for (const [name, value] of Object.entries(TELEMETRY_HEADERS)) assert.equal(post.headers[name.toLowerCase()], value);
  for (const request of apiRequests) assert.equal(request.headers.authorization, undefined);
  assert.equal(providerCalls.length, 1, 'only the permitted POST may invoke Groq');
  assert.equal(providerCalls[0].url, PROVIDER_URL);
  const providerHeaders = new Headers(providerCalls[0].options.headers);
  assert.equal(providerHeaders.get('authorization'), `Bearer ${FIXTURE_KEY}`);
  assert.equal(providerHeaders.get('content-type'), 'application/json');
  assert.deepEqual([...providerHeaders.keys()].sort(), ['authorization', 'content-type'],
    'host-page telemetry must not be forwarded to Groq');
  assert.equal(providerCalls[0].body.model, INPUT.model);
  assert.deepEqual(JSON.parse(providerCalls[0].body.messages[1].content), {
    tema: INPUT.theme, instrucoes_adicionais: INPUT.instructions, texto_de_referencia: INPUT.context
  });
  assert.match(providerCalls[0].body.messages[0].content, /ENEM/);
  assert.match(providerCalls[0].body.messages[0].content, /500 palavras/);
});

test('real browser CORS still blocks an unlisted header before any POST or provider call', { timeout: 20000 }, async t => {
  const { page, context, apiRequests, providerCalls } = await fixture(t, { 'X-Unlisted-Telemetry': 'fixture-only' });
  await configure(page);
  await control(page, 'generate').click();
  await control(page, 'retry-connection').waitFor({ state: 'visible' });
  assert.deepEqual(apiRequests.map(request => request.method), ['OPTIONS']);
  assert.deepEqual(headerNames(apiRequests[0].headers['access-control-request-headers']), [...EXPECTED_HEADERS, 'x-unlisted-telemetry'].sort());
  assert.equal(apiRequests[0].status, 204);
  assert.equal(apiRequests[0].providerCallsAfter, 0);
  assert.equal(providerCalls.length, 0);
  assert.equal(await control(page, 'result').inputValue(), '');
  assert.equal(context.pages().length, 1);
  assert.deepEqual(await page.evaluate(() => window.__openCalls), []);
  assert.deepEqual(await page.evaluate(() => window.__generationInputs), [INPUT]);
});
