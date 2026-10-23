'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test: nodeTest, before, after } = require('node:test');
const { chromium } = require('playwright');

const ACTIVITY_URL = 'https://saladofuturo.educacao.sp.gov.br/atividade/101776678?eRedacao=true&enable_captcha=true';
const API_URL = 'https://redacao-maker.vercel.app/api/generate';
const FRAME_URL = 'https://inaccessible.fixture.test/editor?token=private-frame-token';
const TITLE = 'Bibliotecas e cidadania digital';
const ESSAY = 'As bibliotecas públicas ampliam o acesso ao conhecimento.\n\nInvestir nesses espaços favorece a cidadania digital.';
const IDS = ['r7d2k9v4', 'a8m3q6z1', 'w5b9c2f7', 'n4x8h1j6'];
const DRAFTS = ['Rascunho privado do primeiro título', 'Rascunho privado da primeira redação.', 'Rascunho privado do segundo título', 'Rascunho privado da segunda redação.'];
const test = (name, run) => nodeTest(name, { timeout: 30000 }, run);

let browser;
let script;
let fieldModule;

before(async () => {
  script = fs.readFileSync(path.join(__dirname, '..', 'redator-groq.js'), 'utf8');
  fieldModule = script.match(/\/\/ BEGIN_PAGE_FILL([\s\S]*?)\/\/ END_PAGE_FILL/)[1];
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});

after(async () => { await browser?.close(); });

// Sala's real labels identify the live controls. Opaque IDs, CSS hashes and
// equal textarea heights deliberately provide no indication of their purpose.
function muiField(index, caption = index % 2 ? 'Redação' : 'Titulo', attributes = '') {
  return `<div class="MuiFormControl-root MuiTextField-root css-opaque-control">
    <label class="MuiFormLabel-root MuiInputLabel-root css-opaque-label" for="${IDS[index]}">${caption}</label>
    <div class="MuiInputBase-root MuiInputBase-multiline css-opaque-input">
      <textarea aria-invalid="false" id="${IDS[index]}" data-controlled="${index}" rows="1"
        class="MuiInputBase-input MuiInputBase-inputMultiline css-1ji6r31" style="height:46px" ${attributes}>${DRAFTS[index]}</textarea>
      <textarea aria-hidden="true" tabindex="-1" readonly
        class="MuiInputBase-input MuiInputBase-inputMultiline css-1ji6r31"
        style="visibility:hidden;position:absolute;overflow:hidden;height:0;padding:0;border:0">private-autosize-mirror-${index}</textarea>
    </div></div>`;
}

function pair() { return muiField(0) + muiField(1); }
function ambiguousFields() { return pair() + muiField(2) + muiField(3); }

function documentWith(content, controlled = false, formAttributes = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Atividade de redação</title>
    <link rel="icon" href="data:,"><style>
    body{margin:24px;font:16px sans-serif}main{width:480px}label{display:block;margin:12px 0 5px}
    .MuiInputBase-root{position:relative}.MuiFormControl-root{margin:14px 0}
    input,textarea{display:block;width:440px;box-sizing:border-box}textarea{resize:none}iframe{width:400px;height:100px}
    </style></head><body><main><h1>Atividade</h1>
    <p>Bibliotecas públicas ampliam o acesso ao conhecimento e à inclusão digital.</p>
    <form id="host-editor" ${formAttributes}>${content}<button type="submit">Enviar redação</button></form></main>
    <script>
    window.hostEvents=[];window.hostSubmits=0;window.hostClicks=0;window.hostRenders=0;
    window.hostState=${JSON.stringify(DRAFTS)};
    document.addEventListener('submit',event=>{event.preventDefault();window.hostSubmits++});
    document.addEventListener('click',event=>{if(event.target.closest('main button'))window.hostClicks++});
    for(const kind of ['input','change'])document.addEventListener(kind,event=>{
      if(!event.target.matches('main input,main textarea'))return;
      window.hostEvents.push({kind,id:event.target.id,value:event.target.value});
      if(${controlled}&&kind==='input'&&event.target.hasAttribute('data-controlled')){
        // Both handlers spread shared state, as in a controlled React editor.
        // A fresh render is required between the title and essay updates.
        const nextState={...window.hostState,[event.target.dataset.controlled]:event.target.value};
        setTimeout(()=>{
          window.hostState=nextState;
          const previous=document.getElementById('host-editor');
          const next=previous.cloneNode(true);
          for(const field of next.querySelectorAll('[data-controlled]'))field.value=window.hostState[field.dataset.controlled];
          previous.replaceWith(next);window.hostRenders++;
        },0);
      }
    });
    </script></body></html>`;
}

function control(page, id) { return page.locator(`#redator-groq-console >> #${id}`); }

async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(5000);
  const requests = [];
  const unexpected = [];
  const errors = [];
  let page;
  t.after(async () => {
    if (page && !page.isClosed()) {
      assert.deepEqual(await page.evaluate(() => ({ submits: window.hostSubmits, clicks: window.hostClicks })), { submits: 0, clicks: 0 });
    }
    await context.close();
    assert.deepEqual(unexpected, [], 'Sala fixtures must never reach the school, a provider, or an authentication service');
    assert.deepEqual(errors, [], 'field inspection and filling must not produce uncaught browser errors');
    assert.equal(requests.length, options.expectedRequests ?? 1, 'field selection and retry must not request another generation');
  });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url() === ACTIVITY_URL) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: documentWith(options.content ?? pair(), options.controlled, options.formAttributes) });
    }
    if (options.frame && request.url() === FRAME_URL) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture frame</title><p>private-frame-document</p>' });
    }
    if (request.url() === API_URL) {
      for (const name of ['authorization', 'x-api-key', 'api-key', 'x-access-token', 'x-hub-token', 'cookie']) {
        assert.equal(request.headers()[name], undefined, `public generation must not send ${name}`);
      }
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      assert.equal(request.method(), 'POST');
      requests.push(request.postDataJSON());
      if (options.apiGate) await options.apiGate;
      return route.fulfill({ status: 200, contentType: 'application/json', headers,
        body: JSON.stringify({ title: TITLE, choices: [{ message: { role: 'assistant', content: ESSAY }, finish_reason: 'stop' }] }) });
    }
    unexpected.push(request.url());
    return route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(ACTIVITY_URL);
  await page.addScriptTag({ content: script });
  await page.locator('#redator-groq-console').waitFor();
  await page.addScriptTag({ content: `${fieldModule}\nwindow.fieldInspectorForTest=createPageFill({excludeRoot:document.getElementById('redator-groq-console')});` });
  await control(page, 'open-source').click();
  await control(page, 'context').fill('Bibliotecas públicas oferecem acesso gratuito à internet e formação digital.');
  await control(page, 'save-source').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  return { page, requests };
}

async function ready(page) {
  await page.waitForFunction(() => !document.getElementById('redator-groq-console').shadowRoot.getElementById('generate').disabled,
    null, { timeout: 5000 });
}

async function generate(page) {
  if (await control(page, 'secondary-panel').isVisible()) await control(page, 'secondary-close').click();
  const response = page.waitForResponse(API_URL, { timeout: 5000 });
  await control(page, 'generate').click();
  await response;
  await ready(page);
  await assertResult(page);
}

async function assertResult(page) {
  assert.equal(await control(page, 'result-title').inputValue(), TITLE);
  assert.equal(await control(page, 'result').inputValue(), ESSAY);
}

async function liveValues(page) {
  return page.locator('main textarea[aria-invalid="false"]').evaluateAll(nodes => nodes.map(node => node.value));
}

async function inspect(page) {
  return page.evaluate(() => {
    const inspection = window.fieldInspectorForTest.inspect();
    return { ...inspection, fields: inspection.fields.map(({ element, ...field }) => ({ ...field, element: element.tagName })) };
  });
}

async function openInspector(page) {
  if (!await control(page, 'pane-result').isVisible()) await control(page, 'open-result').click();
  assert.equal(await control(page, 'inspect-fields').isEnabled(), true);
  await control(page, 'inspect-fields').click();
  await control(page, 'field-inspector').waitFor({ state: 'visible' });
  assert.ok((await control(page, 'field-inspector-summary').innerText()).trim());
}

async function expectChosenPair(page) {
  await page.waitForFunction(({ ids, title, essay }) => document.getElementById(ids[2]).value === title && document.getElementById(ids[3]).value === essay,
    { ids: IDS, title: TITLE, essay: ESSAY }, { timeout: 5000 });
  assert.deepEqual(await liveValues(page), [DRAFTS[0], DRAFTS[1], TITLE, ESSAY]);
  await assertResult(page);
}

test('fills actual Sala label-for MUI controls despite a weaker heading title input and shared controlled state', async t => {
  const { page } = await fixture(t, { controlled: true, content: `<section><h2>Título</h2><input id="p9s4t7v2" value="Outro título privado"></section>${pair()}` });
  assert.equal(page.url(), ACTIVITY_URL);
  assert.deepEqual((await inspect(page)).candidateCounts, { title: 1, essay: 1 });
  const mirrors = await page.locator('main textarea[readonly]').evaluateAll(nodes => nodes.map(node => node.value));
  await generate(page);
  assert.deepEqual(await liveValues(page), [TITLE, ESSAY]);
  assert.equal(await page.locator('#p9s4t7v2').inputValue(), 'Outro título privado');
  assert.deepEqual(await page.locator('main textarea[readonly]').evaluateAll(nodes => nodes.map(node => node.value)), mirrors);
  assert.deepEqual(await page.evaluate(() => [window.hostState[0], window.hostState[1]]), [TITLE, ESSAY]);
  assert.equal(await page.evaluate(() => window.hostRenders), 2);
  assert.deepEqual(await page.evaluate(() => window.hostEvents.map(event => [event.kind, event.id])), [
    ['input', IDS[0]], ['change', IDS[0]], ['input', IDS[1]], ['change', IDS[1]],
  ]);
});

test('ranks the explicit essay label above an unrelated weaker Redação heading textarea', async t => {
  const content = `${pair()}<section><h2>Redação</h2><textarea id="b6c1d8g3">Outro texto privado que não deve ser alterado.</textarea></section>`;
  const { page } = await fixture(t, { content });
  assert.deepEqual((await inspect(page)).candidateCounts, { title: 1, essay: 1 });
  await generate(page);
  assert.deepEqual(await liveValues(page), [TITLE, ESSAY]);
  assert.equal(await page.locator('#b6c1d8g3').inputValue(), 'Outro texto privado que não deve ser alterado.');
});

test('fills and inspects Sala controls when hidden and inert named inputs shadow form properties', async t => {
  const content = `<input type="text" name="hidden" style="display:none" value="private-named-hidden-control">
    <input type="text" name="inert" style="display:none" value="private-named-inert-control">${pair()}`;
  const { page } = await fixture(t, { content });
  assert.deepEqual(await page.locator('#host-editor').evaluate(form => ({
    hiddenAttribute: form.hasAttribute('hidden'), inertAttribute: form.hasAttribute('inert'),
    hiddenNamedControl: form.hidden === form.elements.namedItem('hidden'),
    inertNamedControl: form.inert === form.elements.namedItem('inert'),
  })), { hiddenAttribute: false, inertAttribute: false, hiddenNamedControl: true, inertNamedControl: true });
  const inspection = await inspect(page);
  assert.equal(inspection.status, 'ready');
  assert.equal(inspection.textareaCount, 4);
  assert.equal(inspection.editableTextareaCount, 2);
  assert.deepEqual(inspection.candidateCounts, { title: 1, essay: 1 });
  assert.deepEqual(inspection.fields.filter(field => field.editable).map(field => field.id), IDS.slice(0, 2));
  await generate(page);
  assert.deepEqual(await liveValues(page), [TITLE, ESSAY]);
  assert.equal(await page.locator('input[name="hidden"]').inputValue(), 'private-named-hidden-control');
  assert.equal(await page.locator('input[name="inert"]').inputValue(), 'private-named-inert-control');
  assert.deepEqual(await page.evaluate(() => window.hostEvents.map(event => [event.kind, event.id])), [
    ['input', IDS[0]], ['change', IDS[0]], ['input', IDS[1]], ['change', IDS[1]],
  ]);
});

test('continues rejecting real hidden and inert form attributes without changing their drafts', async t => {
  for (const attribute of ['hidden', 'inert']) {
    const { page } = await fixture(t, { formAttributes: attribute });
    assert.equal(await page.locator('#host-editor').evaluate((form, name) => form.hasAttribute(name), attribute), true);
    const inspection = await inspect(page);
    assert.equal(inspection.status, 'not-found', attribute);
    assert.equal(inspection.textareaCount, 4, attribute);
    assert.equal(inspection.editableTextareaCount, 0, attribute);
    assert.deepEqual(inspection.candidateCounts, { title: 0, essay: 0 }, attribute);
    assert.ok(inspection.fields.every(field => !field.editable && field.reason), attribute);
    await generate(page);
    assert.deepEqual(await liveValues(page), DRAFTS.slice(0, 2), attribute);
    assert.deepEqual(await page.evaluate(() => window.hostEvents), [], attribute);
    await assertResult(page);
  }
});

test('retains equal-confidence duplicate Sala labels as ambiguous without changing any draft', async t => {
  const { page } = await fixture(t, { content: ambiguousFields() });
  const inspection = await inspect(page);
  assert.equal(inspection.status, 'ambiguous');
  assert.deepEqual(inspection.candidateCounts, { title: 2, essay: 2 });
  await generate(page);
  assert.deepEqual(await liveValues(page), DRAFTS);
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
  assert.equal(await control(page, 'pick-title').isEnabled(), true);
  assert.equal(await control(page, 'pick-essay').isEnabled(), true);
});

test('reports textarea counts and rejection reasons without exposing values, secrets, or frame URLs', async t => {
  const content = `${pair()}
    <label for="k1l6m3q8">Campo oculto</label><textarea id="k1l6m3q8" hidden>private-hidden-draft</textarea>
    <label for="h7j2k5m9">Campo desativado</label><textarea id="h7j2k5m9" disabled>gsk_private_disabled_secret</textarea>
    <label for="c4f8g1h6">Campo de leitura</label><textarea id="c4f8g1h6" readonly>Bearer private-readonly-secret</textarea>
    <iframe src="${FRAME_URL}"></iframe>`;
  const { page, requests } = await fixture(t, { content, frame: true, expectedRequests: 0 });
  const inspection = await inspect(page);
  assert.deepEqual(Object.keys(inspection).sort(), ['candidateCounts', 'editableTextareaCount', 'fields', 'inaccessibleFrames', 'message', 'status', 'textareaCount']);
  assert.equal(inspection.status, 'ready');
  assert.equal(inspection.textareaCount, 7);
  assert.equal(inspection.editableTextareaCount, 2);
  assert.deepEqual(inspection.candidateCounts, { title: 1, essay: 1 });
  assert.equal(inspection.inaccessibleFrames, 1);
  assert.deepEqual(inspection.fields.filter(field => field.editable).map(field => [field.id, field.label]), [[IDS[0], 'Titulo'], [IDS[1], 'Redação']]);
  assert.deepEqual(inspection.fields.map(field => field.reason), ['', 'readonly', '', 'readonly', 'inert-or-ancestor', 'disabled', 'readonly']);
  for (const field of inspection.fields) {
    assert.deepEqual(Object.keys(field).sort(), ['editable', 'element', 'id', 'label', 'reason']);
    assert.equal(field.element, 'TEXTAREA');
  }
  assert.doesNotMatch(JSON.stringify(inspection), /Rascunho privado|private-|gsk_|Bearer|https?:|enable_captcha|eRedacao/);
  await openInspector(page);
  const list = await control(page, 'field-inspector-list').innerText();
  assert.match(list, /Titulo/);
  assert.match(list, /Redação/);
  assert.match(list, /ocult|vis[ií]vel/i);
  assert.match(list, /leitura|readonly/i);
  assert.doesNotMatch(list, /Rascunho privado|private-|gsk_|Bearer|https?:|enable_captcha|eRedacao/);
  assert.equal(await control(page, 'field-inspector-list').locator('button').count(), 4, 'only the two editable controls offer title and essay choices');
  assert.equal(requests.length, 0);
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
});

test('inspector selects exact ambiguous MUI rows including rejected mirror indices and fills without regenerating', async t => {
  const { page, requests } = await fixture(t, { content: ambiguousFields() });
  await generate(page);
  assert.deepEqual(await liveValues(page), DRAFTS);
  await openInspector(page);
  assert.equal(await control(page, 'select-title-1').count(), 0, 'the readonly autosize mirror is not selectable');
  assert.equal(await control(page, 'select-title-4').isEnabled(), true);
  assert.equal(await control(page, 'select-essay-6').isEnabled(), true);
  await control(page, 'select-title-4').click();
  assert.deepEqual(await liveValues(page), DRAFTS, 'one choice must not overwrite an ambiguous draft');
  await control(page, 'select-essay-6').click();
  await expectChosenPair(page);
  assert.deepEqual(await page.evaluate(() => window.hostEvents.filter(event => event.kind === 'input').map(event => event.id)), [IDS[2], IDS[3]]);
  assert.equal(requests.length, 1);
  await control(page, 'fill-page').click();
  await expectChosenPair(page);
  assert.equal(requests.length, 1);
});

test('allows inspector choices before generation and disables inspection only while the API is busy', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { page, requests } = await fixture(t, { content: ambiguousFields(), apiGate: gate });
  await openInspector(page);
  await control(page, 'select-title-4').click();
  await control(page, 'select-essay-6').click();
  assert.deepEqual(await liveValues(page), DRAFTS);
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
  assert.equal(requests.length, 0);
  assert.equal(await control(page, 'inspect-fields').isEnabled(), true);
  await control(page, 'secondary-close').click();
  const requested = page.waitForRequest(API_URL, { timeout: 5000 });
  await control(page, 'generate').click();
  await requested;
  assert.equal(await control(page, 'inspect-fields').isDisabled(), true);
  const response = page.waitForResponse(API_URL, { timeout: 5000 });
  release();
  await response;
  await ready(page);
  await expectChosenPair(page);
  assert.equal(await control(page, 'inspect-fields').isEnabled(), true);
  assert.equal(requests.length, 1);
});
