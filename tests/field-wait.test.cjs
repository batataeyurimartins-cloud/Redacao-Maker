'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test: nodeTest, before, after } = require('node:test');
const { chromium } = require('playwright');

const ORIGIN = 'https://fixture.redator.test';
const SALA_ORIGIN = 'https://saladofuturo.educacao.sp.gov.br';
const API_URL = 'https://redacao-maker.vercel.app/api/generate';
const TITLE = 'Bibliotecas e cidadania digital';
const ESSAY = 'As bibliotecas públicas ampliam o acesso ao conhecimento.\n\nPor isso, investir nesses espaços favorece a cidadania digital.';
const ORIGINAL_TITLE = 'Meu título em elaboração';
const ORIGINAL_ESSAY = 'Meu rascunho ainda está em elaboração.';
const test = (name, run) => nodeTest(name, { timeout: 25000 }, run);

let browser;
let script;

before(async () => {
  script = fs.readFileSync(path.join(__dirname, '..', 'redator-batata.js'), 'utf8');
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});

after(async () => { await browser?.close(); });

function completion(title = TITLE, essay = ESSAY) {
  return { title, choices: [{ message: { role: 'assistant', content: essay }, finish_reason: 'stop' }] };
}

function titleField(attributes = '') {
  return `<label for="host-title">Título da redação</label><input id="host-title" value="${ORIGINAL_TITLE}" ${attributes}>`;
}

function essayField(attributes = '') {
  return `<label for="host-essay">Texto da redação</label><textarea id="host-essay" ${attributes}>${ORIGINAL_ESSAY}</textarea>`;
}

function fields() { return titleField() + essayField(); }

function html(content = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Atividade de redação</title>
    <link rel="icon" href="data:,"><style>
    body{margin:24px;font:16px sans-serif}main{width:480px}label{display:block;margin:12px 0 4px}
    input,textarea,[contenteditable]{display:block;width:430px;box-sizing:border-box}textarea,[contenteditable]{min-height:140px}
    iframe{display:block;width:450px;height:250px}#shadow-host{display:block;min-height:20px}
    </style></head><body><main><h1>Bibliotecas e inclusão digital</h1>
    <p>Bibliotecas públicas oferecem acesso gratuito à internet e oportunidades de estudo.</p>
    <div id="activity-root">${content}</div></main><script>
    window.hostEvents=[];window.hostSubmits=0;
    document.addEventListener('submit',event=>{event.preventDefault();window.hostSubmits++});
    for(const kind of ['input','change'])document.addEventListener(kind,event=>{
      if(event.target.closest('main'))window.hostEvents.push({kind,id:event.target.id,value:event.target.value??event.target.textContent});
    });
    </script></body></html>`;
}

function control(page, id) {
  return page.locator(`#redator-batata-console >> #${id}`);
}

async function json(route, status, payload) {
  return route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS' }, body: status === 204 ? '' : JSON.stringify(payload) });
}

async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(5000);
  const origin = options.origin || ORIGIN;
  const routePath = options.routePath || '/';
  const requests = [];
  const unexpected = [];
  const errors = [];
  let page;
  t.after(async () => {
    if (page && !page.isClosed()) assert.equal(await page.evaluate(() => window.hostSubmits), 0);
    await context.close();
    assert.deepEqual(unexpected, [], 'field discovery must never reach a school service or live provider');
    assert.deepEqual(errors, [], 'waiting for fields must not produce uncaught browser errors');
    assert.equal(requests.length, options.expectedRequests ?? 1, 'field discovery must not request another generation');
  });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url() === `${origin}${routePath}`) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: html(options.content) });
    }
    if (request.url() === `${origin}/editor.html` && options.iframe) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: options.iframe });
    }
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
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}${routePath}`);
  if (options.clock) await page.clock.install();
  await page.addScriptTag({ content: script });
  await page.locator('#redator-batata-console').waitFor();
  await control(page, 'open-source').click();
  await control(page, 'context').fill('Bibliotecas públicas oferecem acesso gratuito à internet e formação digital.');
  await control(page, 'save-source').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  return { page, requests };
}

async function ready(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('redator-batata-console')?.shadowRoot;
    return root && !root.getElementById('generate').disabled;
  }, null, { timeout: 5000 });
}

async function generate(page) {
  if (await control(page, 'secondary-panel').isVisible()) {
    await control(page, 'secondary-close').click();
    await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  }
  const response = page.waitForResponse(API_URL, { timeout: 5000 });
  await control(page, 'generate').click();
  await response;
  await ready(page);
  assert.equal(await control(page, 'result-title').inputValue(), TITLE);
  assert.equal(await control(page, 'result').inputValue(), ESSAY);
}

async function waiting(page) {
  await control(page, 'field-search-status').waitFor({ state: 'visible' });
  assert.match(await control(page, 'field-search-status').innerText(), /busc|aguard|procur|campo/i);
  assert.equal(await control(page, 'stop-field-search').isVisible(), true);
  for (const id of ['generate', 'fill-page', 'pick-title', 'pick-essay']) {
    assert.equal(await control(page, id).isEnabled(), true, `${id} must remain usable while fields are pending`);
  }
}

async function append(page, content = fields()) {
  await page.evaluate(value => document.getElementById('activity-root').insertAdjacentHTML('beforeend', value), content);
}

async function expectFilled(page, title = TITLE, essay = ESSAY) {
  await page.waitForFunction(({ title, essay }) =>
    document.getElementById('host-title')?.value === title && document.getElementById('host-essay')?.value === essay,
  { title, essay }, { timeout: 5000 });
  await control(page, 'stop-field-search').waitFor({ state: 'hidden' });
}

async function expectOriginal(page) {
  assert.equal(await page.locator('#host-title').inputValue(), ORIGINAL_TITLE);
  assert.equal(await page.locator('#host-essay').inputValue(), ORIGINAL_ESSAY);
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
}

test('keeps searching across several polling intervals and fills delayed editors without regenerating', async t => {
  const { page, requests } = await fixture(t);
  await generate(page);
  await waiting(page);
  // A slow activity route must not be mistaken for a permanently missing editor.
  await page.waitForTimeout(2300);
  await waiting(page);
  assert.equal(requests.length, 1);
  await append(page);
  await expectFilled(page);
});

test('keeps waiting beyond the generation timeout when a successful result already exists', async t => {
  const { page } = await fixture(t, { clock: true });
  await generate(page);
  await waiting(page);
  await page.clock.fastForward(120000);
  await waiting(page);
  await append(page);
  await expectFilled(page);
});

test('waits for a complete pair when the title mounts before the essay', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await append(page, titleField());
  await page.waitForTimeout(1250);
  assert.equal(await page.locator('#host-title').inputValue(), ORIGINAL_TITLE);
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
  await waiting(page);
  await append(page, essayField());
  await expectFilled(page);
});

test('preserves the partial-fill notice and finishes when the missing essay appears', async t => {
  const { page } = await fixture(t, { content: titleField() });
  await generate(page);
  assert.equal(await page.locator('#host-title').inputValue(), TITLE);
  await waiting(page);
  assert.match(await control(page, 'notifications').innerText(), /parcialmente preenchida|preenchimento parcial/i);
  await append(page, essayField());
  await expectFilled(page);
  assert.match(await control(page, 'notifications').innerText(), /Redação preenchida/i);
});

test('preserves user edits to an initially filled title when the missing essay appears', async t => {
  const { page } = await fixture(t, { content: titleField() });
  await generate(page);
  await waiting(page);
  assert.equal(await page.locator('#host-title').inputValue(), TITLE);
  const edited = 'Meu título revisado enquanto a redação carrega';
  await page.locator('#host-title').fill(edited);
  await append(page, essayField());
  await expectFilled(page, edited);
  assert.deepEqual(await page.evaluate(() => window.hostEvents
    .filter(event => event.kind === 'input' && event.id === 'host-title').map(event => event.value)), [TITLE, edited]);
  await page.waitForTimeout(1250);
  assert.equal(await page.locator('#host-title').inputValue(), edited);
});

test('keeps an initially filled title empty when the user clears it before the essay appears', async t => {
  const { page } = await fixture(t, { content: titleField() });
  await generate(page);
  await waiting(page);
  await page.locator('#host-title').fill('');
  await append(page, essayField());
  await expectFilled(page, '');
  assert.deepEqual(await page.evaluate(() => window.hostEvents
    .filter(event => event.kind === 'input' && event.id === 'host-title').map(event => event.value)), [TITLE, '']);
  assert.equal((await control(page, 'notifications').locator('.notification-title').allTextContents())
    .includes('Redação preenchida'), false);
  await page.waitForTimeout(1250);
  assert.equal(await page.locator('#host-title').inputValue(), '');
});

test('rediscovers hidden and disabled fields when they become visible and editable', async t => {
  const { page } = await fixture(t, { content: `<section id="editor" hidden>${titleField('disabled')}${essayField('readonly')}</section>` });
  await generate(page);
  await waiting(page);
  await expectOriginal(page);
  await page.evaluate(() => {
    document.getElementById('editor').hidden = false;
    document.getElementById('host-title').disabled = false;
    document.getElementById('host-essay').readOnly = false;
  });
  await expectFilled(page);
});

test('rechecks the current Sala activity URL after the hub was installed on the SPA home page', async t => {
  const { page } = await fixture(t, { origin: SALA_ORIGIN });
  await generate(page);
  await waiting(page);
  await page.evaluate(() => {
    history.pushState({}, '', '/atividade/fixture?eRedacao=true');
    document.getElementById('activity-root').innerHTML = `<h2>Proposta de redação</h2><section class="MuiBox-root">
      <div class="MuiFormControl-root"><textarea id="a7b6c5d4" class="MuiInputBase-input MuiInputBase-inputMultiline" style="height:46px;min-height:46px">Meu título em elaboração</textarea></div>
      <div class="MuiFormControl-root"><textarea id="e3f2g1h0" class="MuiInputBase-input MuiInputBase-inputMultiline" style="height:46px;min-height:46px">Meu rascunho ainda está em elaboração.</textarea></div>
      </section>`;
  });
  await page.waitForFunction(({ title, essay }) =>
    document.getElementById('a7b6c5d4').value === title && document.getElementById('e3f2g1h0').value === essay,
  { title: TITLE, essay: ESSAY }, { timeout: 5000 });
  await control(page, 'stop-field-search').waitFor({ state: 'hidden' });
});

test('finds labeled editors after more than 30000 unrelated nodes', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await page.evaluate(content => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 30100; index++) fragment.append(document.createElement('span'));
    const editor = document.createElement('section');
    editor.innerHTML = content;
    fragment.append(editor);
    document.getElementById('activity-root').append(fragment);
  }, fields());
  await expectFilled(page);
});

test('uses the fallback poll to find an open shadow editor attached without a light DOM mutation', async t => {
  const { page } = await fixture(t, { content: '<div id="shadow-host"></div>' });
  await generate(page);
  await waiting(page);
  await page.evaluate(content => {
    const root = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:block}label,input,textarea{display:block}input,textarea{width:400px}textarea{height:140px}</style>${content}`;
  }, fields());
  await page.waitForFunction(({ title, essay }) => {
    const root = document.getElementById('shadow-host').shadowRoot;
    return root.getElementById('host-title').value === title && root.getElementById('host-essay').value === essay;
  }, { title: TITLE, essay: ESSAY }, { timeout: 5000 });
  await control(page, 'stop-field-search').waitFor({ state: 'hidden' });
});

test('discovers a same-origin editor frame mounted after generation', async t => {
  const { page } = await fixture(t, { iframe: '<!doctype html><html><head><title>Editor</title></head><body id="tinymce" contenteditable="true" aria-label="Texto da redação"><p>Rascunho no editor.</p></body></html>' });
  await generate(page);
  await waiting(page);
  await append(page, `${titleField()}<iframe id="essay_ifr" title="Texto da redação" src="/editor.html"></iframe>`);
  await page.frameLocator('#essay_ifr').locator('#tinymce').waitFor();
  await page.waitForFunction(({ title, essay }) =>
    document.getElementById('host-title').value === title && document.getElementById('essay_ifr').contentDocument.body.innerText === essay,
  { title: TITLE, essay: ESSAY }, { timeout: 5000 });
  await control(page, 'stop-field-search').waitFor({ state: 'hidden' });
});

test('leaves ambiguous pairs intact until both targets are manually selected, then fills automatically', async t => {
  const content = `<label for="title-one">Título da redação</label><input id="title-one" value="Título um">
    <label for="title-two">Título da redação</label><input id="title-two" value="Título dois">
    <label for="essay-one">Texto da redação</label><textarea id="essay-one">Rascunho um</textarea>
    <label for="essay-two">Texto da redação</label><textarea id="essay-two">Rascunho dois</textarea>`;
  const { page } = await fixture(t, { content });
  await generate(page);
  await waiting(page);
  await page.waitForTimeout(1250);
  assert.deepEqual(await page.locator('main input,main textarea').evaluateAll(nodes => nodes.map(node => node.value)), ['Título um', 'Título dois', 'Rascunho um', 'Rascunho dois']);
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
  await control(page, 'pick-title').click();
  await page.locator('#title-two').click();
  await control(page, 'pick-essay').click();
  await page.locator('#essay-two').click();
  await page.waitForFunction(({ title, essay }) =>
    document.getElementById('title-two').value === title && document.getElementById('essay-two').value === essay,
  { title: TITLE, essay: ESSAY }, { timeout: 5000 });
  assert.equal(await page.locator('#title-one').inputValue(), 'Título um');
  assert.equal(await page.locator('#essay-one').inputValue(), 'Rascunho um');
  await control(page, 'stop-field-search').waitFor({ state: 'hidden' });
});

test('stops future writes on request and lets Preencher página restart the search without another API call', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await control(page, 'stop-field-search').click();
  await control(page, 'stop-field-search').waitFor({ state: 'hidden' });
  await append(page);
  await page.waitForTimeout(1250);
  await expectOriginal(page);
  await page.locator('#host-title,#host-essay').evaluateAll(nodes => nodes.forEach(node => node.remove()));
  await control(page, 'fill-page').click();
  await waiting(page);
  await append(page);
  await expectFilled(page);
});

test('serializes explicit fill retries behind an interrupted background write and its rollback', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await page.evaluate(title => {
    window.manualRetryCount = 0;
    document.addEventListener('input', event => {
      if (event.target.id !== 'host-title' || event.target.value !== title || window.manualRetryCount) return;
      const root = document.getElementById('redator-batata-console').shadowRoot;
      window.retryDuringFill = {
        title: event.target.value,
        essay: document.getElementById('host-essay').value,
        searching: !root.getElementById('stop-field-search').hidden,
        generationIdle: !root.getElementById('generate').disabled,
      };
      // Fire before the background write settles so its cancellation must roll back first.
      for (let index = 0; index < 3; index++) {
        window.manualRetryCount++;
        root.getElementById('fill-page').click();
      }
    });
  }, TITLE);
  await append(page);
  await page.waitForFunction(() => window.hostEvents
    .filter(event => event.kind === 'input' && event.id === 'host-essay').length === 3, null, { timeout: 5000 });
  await expectFilled(page);
  assert.deepEqual(await page.evaluate(() => window.retryDuringFill), {
    title: TITLE, essay: ORIGINAL_ESSAY, searching: true, generationIdle: true,
  });
  assert.equal(await page.evaluate(() => window.manualRetryCount), 3);
  const events = await page.evaluate(() => window.hostEvents);
  assert.deepEqual(events.filter(event => event.kind === 'input' && event.id === 'host-title')
    .map(event => event.value), [TITLE, ORIGINAL_TITLE, TITLE, TITLE, TITLE]);
  assert.deepEqual(events.filter(event => event.kind === 'input' && event.id === 'host-essay')
    .map(event => event.value), [ESSAY, ESSAY, ESSAY]);
  await page.waitForTimeout(1250);
  await expectFilled(page);
  assert.deepEqual(await page.evaluate(() => window.hostEvents), events, 'completed retries must not leave a writer running');
});

test('the main Cancelar button stops field discovery after generation is already idle', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  assert.equal(await control(page, 'generate').isEnabled(), true);
  assert.equal(await control(page, 'cancel').isVisible(), true);
  await control(page, 'cancel').click();
  await control(page, 'stop-field-search').waitFor({ state: 'hidden' });
  await append(page);
  await page.waitForTimeout(1250);
  await expectOriginal(page);
});

test('closing the hub disposes its pending search before new fields mount', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await control(page, 'close').click();
  await page.locator('#redator-batata-console').waitFor({ state: 'detached' });
  await append(page);
  await page.waitForTimeout(1250);
  await expectOriginal(page);
  await page.addScriptTag({ content: script });
  await page.locator('#redator-batata-console').waitFor();
  await page.waitForTimeout(1250);
  await expectOriginal(page);
  assert.equal(await control(page, 'result').inputValue(), '');
});

test('reinjecting the same version preserves one search without duplicate fills', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await page.addScriptTag({ content: script });
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
  await append(page);
  await expectFilled(page);
  await page.waitForTimeout(1250);
  assert.deepEqual(await page.evaluate(() => window.hostEvents.map(event => [event.kind, event.id])), [
    ['input', 'host-title'], ['change', 'host-title'], ['input', 'host-essay'], ['change', 'host-essay'],
  ]);
});

test('replacing an older hub version disposes its search and keeps the new result empty', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await page.evaluate(() => { document.getElementById('redator-batata-console').dataset.redatorVersion = 'old-fixture-version'; });
  await page.addScriptTag({ content: script });
  assert.equal(await page.locator('#redator-batata-console').count(), 1);
  await append(page);
  await page.waitForTimeout(1250);
  await expectOriginal(page);
  assert.equal(await control(page, 'result').inputValue(), '');
});

test('starting a new generation cancels the old search before waiting for the next response', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const nextTitle = 'Novas bibliotecas para todos';
  const nextEssay = 'Uma nova redação para revisar antes de enviar.';
  t.after(() => release());
  const { page } = await fixture(t, { expectedRequests: 2, api: async (route, count) => {
    if (count === 1) return json(route, 200, completion());
    await pending;
    return json(route, 200, completion(nextTitle, nextEssay)).catch(() => {});
  } });
  await generate(page);
  await waiting(page);
  await control(page, 'secondary-close').click();
  const request = page.waitForRequest(API_URL);
  await control(page, 'generate').click();
  await request;
  await append(page);
  await page.waitForTimeout(1250);
  await expectOriginal(page);
  const response = page.waitForResponse(API_URL);
  release();
  await response;
  await ready(page);
  await expectFilled(page, nextTitle, nextEssay);
});

test('stops observing after a complete fill and preserves subsequent user edits', async t => {
  const { page } = await fixture(t);
  await generate(page);
  await waiting(page);
  await append(page);
  await expectFilled(page);
  await page.locator('#host-title').fill('Meu título revisado');
  await page.locator('#host-essay').fill('Minha revisão pessoal da redação.');
  await append(page, '<p>O aplicativo terminou outra atualização.</p>');
  await page.waitForTimeout(1250);
  assert.equal(await page.locator('#host-title').inputValue(), 'Meu título revisado');
  assert.equal(await page.locator('#host-essay').inputValue(), 'Minha revisão pessoal da redação.');
  assert.equal(await control(page, 'stop-field-search').isVisible(), false);
});
