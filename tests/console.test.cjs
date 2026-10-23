const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const scriptPath = path.join(__dirname, '..', 'redator-batata.js');
const API_URL = process.env.HUB_API_URL || 'https://redacao-maker.vercel.app/api/generate';
const fixture = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Tema de redação</title></head>
<body><nav>MENU_QUE_NAO_E_FONTE</nav><main><h1>A inclusão digital no Brasil</h1>
<p id="selection-target">O acesso à internet permite estudar e participar da sociedade.</p>
<p>O custo da conexão ainda cria barreiras de acesso.</p>
<p hidden>SEGREDO_HIDDEN</p><div style="display:none"><p>SEGREDO_DISPLAY</p></div>
<p style="visibility:hidden">SEGREDO_VISIBILITY</p>
<form><label>SEGREDO_FORMULARIO<input value="SEGREDO_INPUT"></label>
<textarea>SEGREDO_TEXTAREA</textarea><select><option>SEGREDO_SELECT</option></select></form>
<div contenteditable="true">SEGREDO_EDITOR</div></main><footer>RODAPE_QUE_NAO_E_FONTE</footer></body></html>`;

let browser;
let script;

before(async () => {
  script = fs.readFileSync(scriptPath, 'utf8');
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); });

function reply(content = 'Redação de exemplo, com introdução, desenvolvimento e conclusão.', finishReason = 'stop') {
  return { choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }] };
}

async function mount(t, handler = async route => jsonResponse(route, 200, reply()), html = fixture) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const directProviderRequests = [];
  t.after(() => context.close());
  t.after(() => assert.deepEqual(directProviderRequests, [], 'the browser must not call the provider directly'));
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).hostname === 'api.groq.com') {
      directProviderRequests.push(route.request().url());
      return route.abort();
    }
    if (route.request().url() === API_URL) {
      const headers = route.request().headers();
      for (const name of ['authorization', 'x-api-key', 'api-key', 'x-access-token', 'x-hub-token']) {
        assert.equal(headers[name], undefined, `public requests must not include ${name}`);
      }
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders() });
      }
      return handler(route);
    }
    if (route.request().url() === 'http://fixture.redator.test/') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    return route.abort();
  });
  await page.goto('http://fixture.redator.test/');
  await page.addScriptTag({ content: script });
  await page.locator('#redator-batata-console').waitFor();
  return page;
}

function corsHeaders() {
  return { 'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS' };
}

async function jsonResponse(route, status, body, extraHeaders = {}) {
  return route.fulfill({ status, contentType: 'application/json',
    headers: { ...corsHeaders(), ...extraHeaders }, body: JSON.stringify(body) });
}

function control(page, id) {
  return page.locator(`#redator-batata-console >> #${id}`);
}

async function openPane(page, pane) {
  if (!await control(page, `pane-${pane}`).isVisible()) {
    await control(page, `open-${pane}`).click();
    await control(page, `pane-${pane}`).waitFor({ state: 'visible' });
  }
}

async function closeSecondary(page) {
  if (await control(page, 'secondary-panel').isVisible()) {
    await control(page, 'secondary-close').click();
    await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  }
}

async function configure(page, context = 'A inclusão digital ainda enfrenta barreiras econômicas no Brasil.') {
  await openPane(page, 'source');
  await control(page, 'context').fill(context);
  await control(page, 'save-source').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
}

async function waitReady(page) {
  await control(page, 'generate').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const root = document.querySelector('#redator-batata-console')?.shadowRoot;
    return root && !root.querySelector('#generate').disabled;
  });
}

async function generateAndWait(page) {
  await closeSecondary(page);
  const response = page.waitForResponse(API_URL);
  await control(page, 'generate').click();
  await response;
  await waitReady(page);
}

test('captures relevant visible text without private controls, navigation or its own UI', async t => {
  const page = await mount(t);
  await openPane(page, 'source');
  await control(page, 'capture-page').click();
  const content = await control(page, 'context').inputValue();
  assert.match(content, /inclusão digital/);
  assert.match(content, /custo da conexão/);
  assert.doesNotMatch(content, /SEGREDO_|MENU_QUE_NAO_E_FONTE|RODAPE_QUE_NAO_E_FONTE/);
  assert.doesNotMatch(content, /Gerar redação|Código de acesso|Chave da API|gsk_/i);
});

test('captures a user-selected excerpt independently from the whole-page context', async t => {
  const page = await mount(t);
  const expected = await page.locator('#selection-target').textContent();
  await openPane(page, 'source');
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#selection-target'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await control(page, 'capture-selection').click();
  assert.equal((await control(page, 'context').inputValue()).trim(), expected.trim());
});

test('sends anonymous requests with edited context and settings and renders output as plain text', async t => {
  let request;
  const output = '<img src=x onerror="window.PWNED=true">\n\nUma redação em texto puro.';
  const page = await mount(t, async route => {
    request = { data: route.request().postDataJSON(), headers: route.request().headers() };
    await jsonResponse(route, 200, reply(output));
  });
  const context = 'CONTEXTO_EDITADO: bibliotecas públicas oferecem internet gratuita.';
  await configure(page, context);
  await openPane(page, 'genre');
  await control(page, 'choice-level-4').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  await openPane(page, 'writing');
  await control(page, 'theme').fill('Inclusão digital e cidadania');
  await control(page, 'instructions').fill('Discuta o papel das bibliotecas públicas.');
  await control(page, 'save-writing').click();
  await generateAndWait(page);
  assert.equal(request.headers.authorization, undefined);
  assert.deepEqual(Object.keys(request.data).sort(), ['context', 'instructions', 'level', 'theme', 'words']);
  assert.equal(request.data.context, context);
  assert.equal(request.data.theme, 'Inclusão digital e cidadania');
  assert.equal(request.data.instructions, 'Discuta o papel das bibliotecas públicas.');
  assert.equal(request.data.level, 4);
  assert.equal(request.data.words, 350);
  const sent = JSON.stringify(request.data);
  assert.doesNotMatch(sent, /custo da conexão|SEGREDO_/);
  assert.equal(await control(page, 'result').inputValue(), output);
  assert.equal(await control(page, 'pane-result').isVisible(), true);
  assert.equal(await page.evaluate(() => window.PWNED), undefined);
  assert.equal(await page.locator('#redator-batata-console >> img').count(), 0);
});

test('repeated execution keeps a single panel and preserves the user draft', async t => {
  const page = await mount(t);
  await openPane(page, 'source');
  await control(page, 'context').fill('Um contexto já revisado pelo usuário.');
  await control(page, 'save-source').click();
  await page.addScriptTag({ content: script });
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
  assert.equal(await control(page, 'context').inputValue(), 'Um contexto já revisado pelo usuário.');
});

for (const [status, pattern] of [
  [401, /serviço|servidor|autentica|inválid|401/i],
  [429, /limite|muitas|aguard|429|requisiç/i],
  [500, /batata|servidor|tente|500|indispon/i],
]) {
  test(`handles HTTP ${status} and permits a successful retry`, async t => {
    let calls = 0;
    const page = await mount(t, async route => {
      calls += 1;
      return calls === 1
        ? jsonResponse(route, status, { error: { message: 'Falha de teste.', type: 'test_error' } })
        : jsonResponse(route, 200, reply('Texto recuperado após a nova tentativa.'));
    });
    await configure(page);
    await generateAndWait(page);
    const statusText = await control(page, 'status').textContent();
    assert.match(statusText, pattern);
    await generateAndWait(page);
    assert.equal(await control(page, 'result').inputValue(), 'Texto recuperado após a nova tentativa.');
    assert.equal(calls, 2);
  });
}

for (const [label, body] of [
  ['empty output', reply('   ')],
  ['missing choices', { error: 'not an OpenAI completion' }],
  ['malformed completion', { choices: [{ message: { content: { text: 'wrong type' } } }] }],
]) {
  test(`reports ${label} and allows recovery`, async t => {
    let calls = 0;
    const page = await mount(t, async route => {
      calls += 1;
      return jsonResponse(route, 200, calls === 1 ? body : reply('Uma resposta válida.'));
    });
    await configure(page);
    await generateAndWait(page);
    assert.match(await control(page, 'status').textContent(), /resposta|vazi|inválid|formato|erro/i);
    assert.equal(await control(page, 'result').inputValue(), '');
    await generateAndWait(page);
    assert.equal(await control(page, 'result').inputValue(), 'Uma resposta válida.');
  });
}

test('preserves a truncated response while clearly warning that it is incomplete', async t => {
  const partial = 'Uma introdução que foi interrompida no meio';
  const page = await mount(t, route => jsonResponse(route, 200, reply(partial, 'length')));
  await configure(page);
  await generateAndWait(page);
  assert.equal(await control(page, 'result').inputValue(), partial);
  assert.match(await control(page, 'status').textContent(), /limite|truncad|incomplet|interrompid/i);
});

test('cancels a pending generation and immediately permits another request', async t => {
  let notifyRequest;
  const received = new Promise(resolve => { notifyRequest = resolve; });
  let calls = 0;
  const page = await mount(t, async route => {
    calls += 1;
    if (calls === 1) {
      notifyRequest();
      return;
    }
    await jsonResponse(route, 200, reply('Resposta depois de cancelar.'));
  });
  await configure(page);
  await control(page, 'generate').click();
  await received;
  assert.equal(await control(page, 'generate').isDisabled(), true);
  const failed = page.waitForEvent('requestfailed', { predicate: request => request.url() === API_URL });
  await control(page, 'cancel').click();
  await failed;
  await waitReady(page);
  assert.match(await control(page, 'status').textContent(), /cancelad|interrompid/i);
  await generateAndWait(page);
  assert.equal(await control(page, 'result').inputValue(), 'Resposta depois de cancelar.');
});

test('closing the panel aborts a pending generation and removes the UI', async t => {
  let notifyRequest;
  const received = new Promise(resolve => { notifyRequest = resolve; });
  const page = await mount(t, async () => { notifyRequest(); });
  await configure(page);
  await control(page, 'generate').click();
  await received;
  const failed = page.waitForEvent('requestfailed', { predicate: request => request.url() === API_URL });
  await control(page, 'close').click();
  await failed;
  assert.equal(await page.locator('#redator-batata-console').count(), 0);
});

test('never persists reference text or writing settings in browser storage', async t => {
  const page = await mount(t);
  await openPane(page, 'genre');
  await control(page, 'choice-level-5').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  await openPane(page, 'writing');
  await control(page, 'theme').fill('TEMA_PRIVADO_SOMENTE_NA_MEMORIA');
  await control(page, 'instructions').fill('INSTRUCOES_PRIVADAS_SOMENTE_NA_MEMORIA');
  await control(page, 'save-writing').click();
  await configure(page, 'CONTEUDO_PRIVADO_SOMENTE_NA_MEMORIA');
  await generateAndWait(page);
  const stored = await page.evaluate(() => JSON.stringify({
    local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie,
  }));
  assert.doesNotMatch(stored, /TEMA_PRIVADO_SOMENTE_NA_MEMORIA|INSTRUCOES_PRIVADAS_SOMENTE_NA_MEMORIA|CONTEUDO_PRIVADO_SOMENTE_NA_MEMORIA/);
  assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie })),
    { local: {}, session: {}, cookie: '' });
  await control(page, 'close').click();
  await page.addScriptTag({ content: script });
  assert.doesNotMatch(await control(page, 'context').inputValue(), /CONTEUDO_PRIVADO_SOMENTE_NA_MEMORIA/);
  assert.equal(await control(page, 'level').inputValue(), '3');
  assert.equal(await control(page, 'theme').inputValue(), '');
  assert.equal(await control(page, 'instructions').inputValue(), '');
});

test('does not call the public backend without usable reference text', async t => {
  let calls = 0;
  const page = await mount(t, async route => { calls += 1; await jsonResponse(route, 200, reply()); });
  await openPane(page, 'source');
  await control(page, 'context').fill('   ');
  await control(page, 'save-source').click();
  await control(page, 'generate').click();
  assert.match(await control(page, 'status').textContent(), /referência|texto|trecho/i);
  assert.equal(await control(page, 'pane-source').isVisible(), true);
  assert.equal(calls, 0);
});

test('reports invalid JSON from an HTTP 200 response and releases the generation controls', async t => {
  const page = await mount(t, route => route.fulfill({ status: 200, contentType: 'application/json',
    headers: corsHeaders(), body: '{"choices":' }));
  await configure(page);
  await generateAndWait(page);
  assert.match(await control(page, 'status').textContent(), /resposta|inválid|formato/i);
  assert.equal(await control(page, 'result').inputValue(), '');
});

test('limits long captures with a visible notice instead of silently sending an entire page', async t => {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><main><p>' +
    'Conteúdo de referência para a redação. '.repeat(800) + '</p></main></body></html>';
  const page = await mount(t, undefined, html);
  const captured = await control(page, 'context').inputValue();
  assert.ok(captured.length > 17000 && captured.length <= 18000);
  assert.match(await control(page, 'status').textContent(), /limitad|cort|18\.000/i);
});

test('falls back to body content and repeated capture excludes its own panel and form controls', async t => {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<nav>SEGREDO_MENU</nav><p>A leitura fortalece a participação social.</p>' +
    '<form>SEGREDO_FORM<input value="SEGREDO_INPUT"></form>' +
    '<div contenteditable="true">SEGREDO_EDITOR</div></body></html>';
  const page = await mount(t, undefined, html);
  await openPane(page, 'source');
  await control(page, 'capture-page').click();
  const captured = await control(page, 'context').inputValue();
  assert.match(captured, /A leitura fortalece/);
  assert.doesNotMatch(captured, /SEGREDO_|Gerar redação|Código de acesso|Chave da API/i);
});

test('preserves a successful essay when a later generation fails', async t => {
  let calls = 0;
  const firstEssay = 'Esta redação já foi gerada e deve continuar disponível.';
  const page = await mount(t, async route => {
    calls += 1;
    return calls === 1 ? jsonResponse(route, 200, reply(firstEssay))
      : jsonResponse(route, 500, { error: { message: 'Falha temporária.' } });
  });
  await configure(page);
  await generateAndWait(page);
  await generateAndWait(page);
  assert.equal(await control(page, 'result').inputValue(), firstEssay);
  assert.equal(await control(page, 'copy').isDisabled(), false);
  assert.equal(await control(page, 'download').isDisabled(), false);
  assert.match(await control(page, 'status').textContent(), /indispon|servidor|500|tente/i);
});

test('aborts a request after the timeout and recovers without waiting 90 real seconds', async t => {
  let notifyRequest;
  const received = new Promise(resolve => { notifyRequest = resolve; });
  let calls = 0;
  const page = await mount(t, async route => {
    calls += 1;
    if (calls === 1) { notifyRequest(); return; }
    return jsonResponse(route, 200, reply('Funcionou depois do tempo esgotado.'));
  });
  await configure(page);
  await page.clock.install();
  await control(page, 'generate').click();
  await received;
  const failed = page.waitForEvent('requestfailed', { predicate: request => request.url() === API_URL });
  await page.clock.fastForward(91000);
  await failed;
  await waitReady(page);
  assert.match(await control(page, 'status').textContent(), /90 segundos|demorou|tempo|interrompid/i);
  await generateAndWait(page);
  assert.equal(await control(page, 'result').inputValue(), 'Funcionou depois do tempo esgotado.');
});

test('downloads the exact essay as UTF-8 text', async t => {
  const essay = 'Inclusão e cidadania\n\nA conexão permite educação, participação e acesso à informação.';
  const page = await mount(t, route => jsonResponse(route, 200, reply(essay)));
  await configure(page);
  await generateAndWait(page);
  const downloading = page.waitForEvent('download');
  await control(page, 'download').click();
  const download = await downloading;
  assert.match(download.suggestedFilename(), /\.txt$/);
  const filePath = await download.path();
  assert.equal(fs.readFileSync(filePath, 'utf8'), essay);
});

test('captures closed-details summaries while excluding their collapsed contents', async t => {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><main>' +
    '<p>Texto visível para a referência.</p><details><summary>Resumo público</summary>' +
    '<p>SEGREDO_FECHADO</p>SEGREDO_TEXTO_DIRETO</details></main></body></html>';
  const page = await mount(t, undefined, html);
  const captured = await control(page, 'context').inputValue();
  assert.match(captured, /Texto visível|Resumo público/);
  assert.match(captured, /Resumo público/);
  assert.doesNotMatch(captured, /SEGREDO_/);
});

test('an empty main element does not suppress readable article or body fallback content', async t => {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<main><div hidden>SEGREDO_MAIN</div></main><article><p>Uma referência legível fora do main.</p></article>' +
    '<nav>SEGREDO_MENU</nav></body></html>';
  const page = await mount(t, undefined, html);
  const captured = await control(page, 'context').inputValue();
  assert.match(captured, /Uma referência legível fora do main/);
  assert.doesNotMatch(captured, /SEGREDO_/);
});

test('a hidden fallback body does not expose direct text nodes', async t => {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body style="display:none">SEGREDO_TEXTO_DIRETO<p>SEGREDO_PARAGRAFO</p></body></html>';
  const page = await mount(t, undefined, html);
  assert.equal(await control(page, 'context').inputValue(), '');
  assert.match(await control(page, 'status').textContent(), /não encontrei|legível|cole|selecione/i);
});

test('starts with a compact dark hub in the bottom-right corner and no secondary card', async t => {
  const page = await mount(t);
  const card = control(page, 'main-panel');
  const bounds = await card.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds.width <= 300, `hub width is ${bounds.width}px`);
  assert.ok(bounds.height <= 420, `hub height is ${bounds.height}px`);
  assert.ok(bounds.x >= viewport.width / 2);
  assert.ok(viewport.width - (bounds.x + bounds.width) <= 24);
  assert.ok(viewport.height - (bounds.y + bounds.height) <= 24);
  const background = await card.evaluate(node => getComputedStyle(node).backgroundColor);
  const channels = background.match(/[\d.]+/g).slice(0, 3).map(Number);
  assert.ok(channels.every(channel => channel <= 45), `hub background is ${background}`);
  assert.equal(await control(page, 'secondary-panel').isVisible(), false);
  assert.equal(await control(page, 'open-genre').locator('.setting-label').textContent(), 'Tipo');
  assert.match(await control(page, 'summary-genre').textContent(), /3/);
  assert.equal(await control(page, 'level').inputValue(), '3');
  for (const id of ['model', 'genre', 'open-connection', 'pane-connection', 'save-connection']) {
    assert.equal(await control(page, id).count(), 0, `${id} must not be part of the hub`);
  }
  assert.equal(await control(page, 'api-key').count(), 0);
  assert.equal(await page.locator('#redator-batata-console >> input[type="password"]').count(), 0);
  assert.doesNotMatch(script, /PERSONAL_ACCESS_TOKEN|HUB_ACCESS_TOKEN/);
});

test('level and word choices open opposite the hub, close after selection, and affect summaries and generation', async t => {
  let payload;
  const page = await mount(t, route => {
    payload = route.request().postDataJSON();
    return jsonResponse(route, 200, reply());
  });
  await configure(page);
  await openPane(page, 'genre');
  const secondary = await control(page, 'secondary-panel').boundingBox();
  const main = await control(page, 'main-panel').boundingBox();
  assert.ok(secondary.x + secondary.width <= main.x, 'secondary card should be left of the main hub');
  assert.equal(await control(page, 'pane-genre').locator('[data-choice="level"]').count(), 5);
  await control(page, 'choice-level-4').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'secondary-panel').isVisible(), false);
  assert.match(await control(page, 'summary-genre').textContent(), /4/);
  assert.equal(await control(page, 'level').inputValue(), '4');
  assert.equal(await page.evaluate(() => document.querySelector('#redator-batata-console').shadowRoot.activeElement?.id), 'open-genre');
  await openPane(page, 'words');
  await control(page, 'choice-words-500').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'secondary-panel').isVisible(), false);
  assert.match(await control(page, 'summary-words').textContent(), /500/);
  assert.equal(await control(page, 'words').inputValue(), '500');
  await generateAndWait(page);
  assert.equal(payload.level, 4);
  assert.equal(payload.words, 500);
  assert.equal(payload.genre, undefined);
  assert.equal(payload.model, undefined);
});

test('switching functions keeps exactly one secondary pane visible', async t => {
  const page = await mount(t);
  await openPane(page, 'writing');
  await openPane(page, 'source');
  await control(page, 'pane-writing').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'pane-writing').isVisible(), false);
  assert.equal(await control(page, 'pane-source').isVisible(), true);
  assert.equal(await page.locator('#redator-batata-console >> [id^="pane-"]:visible').count(), 1);
  assert.equal(await page.locator('#redator-batata-console >> #secondary-panel:visible').count(), 1);
});

test('Escape closes the secondary pane and restores focus to the triggering hub button', async t => {
  const page = await mount(t);
  await openPane(page, 'writing');
  await control(page, 'theme').focus();
  await page.keyboard.press('Escape');
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.querySelector('#redator-batata-console').shadowRoot.activeElement?.id), 'open-writing');
  assert.equal(await control(page, 'main-panel').isVisible(), true);
});

test('an outside click closes the secondary pane without closing the hub', async t => {
  const page = await mount(t);
  await openPane(page, 'source');
  await page.locator('#selection-target').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'main-panel').isVisible(), true);
});

test('saving edited configuration closes its card and updates the hub summaries', async t => {
  const page = await mount(t);
  await configure(page, 'Referência revisada pelo usuário para uma nova redação.');
  assert.equal(await control(page, 'secondary-panel').isVisible(), false);
  await openPane(page, 'genre');
  await control(page, 'choice-level-5').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.match(await control(page, 'summary-genre').textContent(), /5/);
  assert.match(await control(page, 'summary-source').textContent(), /\d/);
  await openPane(page, 'writing');
  await control(page, 'theme').fill('Leitura e cidadania');
  await control(page, 'instructions').fill('Discuta como bibliotecas ampliam o acesso à leitura.');
  await control(page, 'save-writing').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  assert.equal(await control(page, 'secondary-panel').isVisible(), false);
  assert.match(await control(page, 'summary-writing').textContent(), /Leitura e cidadania/);
  await openPane(page, 'writing');
  assert.equal(await control(page, 'theme').inputValue(), 'Leitura e cidadania');
  assert.equal(await control(page, 'instructions').inputValue(), 'Discuta como bibliotecas ampliam o acesso à leitura.');
});

for (const width of [390, 320]) {
  test(`hub and every secondary function fit within a ${width}px mobile viewport`, async t => {
    const page = await mount(t);
    await page.setViewportSize({ width, height: 844 });
    const main = await control(page, 'main-panel').boundingBox();
    assert.ok(main.x >= -1 && main.x + main.width <= width + 1);
    for (const pane of ['source', 'genre', 'words', 'writing', 'result']) {
      await openPane(page, pane);
      const bounds = await control(page, 'secondary-panel').boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${pane} overflows ${width}px viewport`);
      assert.ok(await control(page, 'secondary-panel').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${pane} has horizontal content overflow`);
      await closeSecondary(page);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });
}

test('mobile reinjection restores the hub from an open secondary pane and preserves the current draft', async t => {
  const page = await mount(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPane(page, 'genre');
  await control(page, 'choice-level-5').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  await configure(page);
  await openPane(page, 'source');
  const draft = 'Rascunho em revisão, ainda sem confirmar o texto de referência.';
  await control(page, 'context').fill(draft);
  assert.equal(await control(page, 'main-panel').isVisible(), false);
  await page.addScriptTag({ content: script });
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
  assert.equal(await control(page, 'main-panel').isVisible(), true);
  assert.equal(await control(page, 'secondary-panel').isVisible(), false);
  assert.equal(await control(page, 'context').inputValue(), draft);
  assert.equal(await control(page, 'level').inputValue(), '5');
});

test('upgrading a legacy provider panel calls its cleanup once and replaces it with one Batata hub', async t => {
  const page = await mount(t);
  await control(page, 'close').click();
  await page.evaluate(() => {
    const oldPanel = document.createElement('div');
    oldPanel.id = 'redator-groq-console';
    oldPanel.dataset.redatorVersion = '1.0.0';
    const oldClose = document.createElement('button');
    oldClose.id = 'close';
    window.oldPanelCloseCalls = 0;
    oldClose.addEventListener('click', () => {
      window.oldPanelCloseCalls += 1;
      oldPanel.remove();
    });
    oldPanel.attachShadow({ mode: 'open' }).append(oldClose);
    document.documentElement.append(oldPanel);
    window.oldPanelForTest = oldPanel;
  });
  await page.addScriptTag({ content: script });
  assert.equal(await page.evaluate(() => window.oldPanelCloseCalls), 1);
  assert.equal(await page.evaluate(() => window.oldPanelForTest.isConnected), false);
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
  assert.equal(await control(page, 'main-panel').isVisible(), true);
  assert.equal(await page.locator('#redator-batata-console').getAttribute('data-redator-version'), '1.10.0');
  assert.equal(await page.locator('#redator-groq-console').count(), 0);
  await page.addScriptTag({ content: script });
  assert.equal(await page.evaluate(() => window.oldPanelCloseCalls), 1);
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
});

test('mobile validation errors remain visible in the secondary card and a successful save clears them', async t => {
  const page = await mount(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPane(page, 'source');
  await control(page, 'context').fill('   ');
  await control(page, 'save-source').click();
  await control(page, 'generate').click();
  assert.equal(await control(page, 'main-panel').isVisible(), false);
  assert.equal(await control(page, 'pane-source').isVisible(), true);
  assert.equal(await control(page, 'secondary-status').isVisible(), true);
  assert.match(await control(page, 'secondary-status').textContent(), /referência|texto|trecho/i);
  await control(page, 'context').fill('Uma referência válida para a redação pública.');
  await control(page, 'save-source').click();
  assert.equal(await control(page, 'main-panel').isVisible(), true);
  assert.equal(await control(page, 'status').getAttribute('data-kind'), 'info');
  await openPane(page, 'source');
  assert.equal(await control(page, 'secondary-status').isVisible(), false);
});
