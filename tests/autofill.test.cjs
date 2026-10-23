'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test: nodeTest, before, after } = require('node:test');
const { chromium } = require('playwright');

const ORIGIN = 'https://fixture.redator.test';
const API_URL = 'https://redacao-maker.vercel.app/api/generate';
const TITLE = 'Bibliotecas e cidadania digital';
const ESSAY = 'As bibliotecas públicas ampliam o acesso ao conhecimento.\n\nPor isso, investir nesses espaços favorece a cidadania digital.';
const ORIGINAL_TITLE = 'Meu título em elaboração';
const ORIGINAL_ESSAY = 'Meu rascunho ainda está em elaboração.';
const test = (name, run) => nodeTest(name, { timeout: 20000 }, run);

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

function completion(title = TITLE, essay = ESSAY, finishReason = 'stop') {
  return { title, choices: [{ message: { role: 'assistant', content: essay }, finish_reason: finishReason }] };
}

function documentWith(content, behavior = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Atividade de redação</title>
    <style>body{margin:24px;font-family:sans-serif}main{width:480px}label{display:block;margin:12px 0}input,textarea,[contenteditable]{display:block;width:430px;box-sizing:border-box}textarea,[contenteditable]{min-height:140px}iframe{width:450px;height:190px}</style>
    </head><body><main><h1>Bibliotecas e inclusão digital</h1>
    <p>Bibliotecas públicas oferecem acesso à internet e oportunidades de estudo.</p>${content}</main>
    <script>window.hostEvents=[];window.hostSubmits=0;window.hostClicks=0;
    document.addEventListener('submit',event=>{event.preventDefault();window.hostSubmits++});
    document.addEventListener('click',event=>{if(event.target.closest('main button'))window.hostClicks++});
    for(const kind of ['input','change'])document.addEventListener(kind,event=>{if(event.target.closest('main'))window.hostEvents.push({kind,id:event.target.id,value:event.target.value??event.target.textContent})});
    ${behavior}</script></body></html>`;
}

function standardForm(extra = '') {
  return `<form id="host-form"><label for=":r17:">Titulo</label>
    <textarea id=":r17:" data-host-title>${ORIGINAL_TITLE}</textarea>
    <label for=":r18:">Redação</label><textarea id=":r18:" data-host-essay>${ORIGINAL_ESSAY}</textarea>
    <button id="host-save" type="submit">Enviar redação</button>${extra}</form>`;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function control(page, id) {
  return page.locator(`#redator-groq-console >> #${id}`);
}

async function json(route, status, payload) {
  return route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS' }, body: JSON.stringify(payload) });
}

async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(5000);
  const requests = [];
  const unexpected = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(unexpected, [], 'autofill must only contact the public generation endpoint');
  });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url() === `${ORIGIN}/`) {
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: documentWith(options.content ?? standardForm(), options.behavior) });
    }
    if (request.url() === `${ORIGIN}/editor.html` && options.iframe) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: options.iframe });
    }
    if (request.url() === API_URL) {
      for (const name of ['authorization', 'x-api-key', 'api-key', 'x-access-token', 'x-hub-token']) {
        assert.equal(request.headers()[name], undefined, `public requests must not contain ${name}`);
      }
      if (request.method() === 'OPTIONS') return json(route, 204, null);
      assert.equal(request.method(), 'POST');
      requests.push(request.postDataJSON());
      return options.api ? options.api(route, requests.length) : json(route, 200, completion());
    }
    unexpected.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ content: script });
  await page.locator('#redator-groq-console').waitFor();
  await control(page, 'open-source').click();
  await control(page, 'context').fill('Bibliotecas públicas oferecem acesso gratuito à internet e formação digital.');
  await control(page, 'save-source').click();
  await control(page, 'secondary-panel').waitFor({ state: 'hidden' });
  return { page, requests };
}

async function ready(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('redator-groq-console')?.shadowRoot;
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
}

async function hostDraft(page) {
  return { title: await page.locator('#host-title, [data-host-title]').inputValue(), essay: await page.locator('#host-essay, [data-host-essay]').inputValue() };
}

async function assertResult(page, title = TITLE, essay = ESSAY) {
  assert.equal(await control(page, 'result-title').inputValue(), title);
  assert.equal(await control(page, 'result').inputValue(), essay);
  assert.equal(await control(page, 'result-title').getAttribute('readonly'), '');
}

async function resultMessage(page) {
  return `${await control(page, 'status').innerText()} ${await control(page, 'pane-result').innerText()}`;
}

test('fills distinct labeled title and essay fields without submitting or clicking the host form', async t => {
  const { page, requests } = await fixture(t);
  await generate(page);
  assert.deepEqual(await hostDraft(page), { title: TITLE, essay: ESSAY });
  await assertResult(page);
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['context', 'instructions', 'level', 'theme', 'words']);
  assert.equal(requests[0].level, 3);
  assert.equal(requests[0].words, 350);
  assert.deepEqual(await page.evaluate(() => ({ submits: window.hostSubmits, clicks: window.hostClicks })), { submits: 0, clicks: 0 });
  assert.equal(await control(page, 'fill-page').isVisible(), true);
});

test('fills contenteditable paragraphs with literal model text and never executes markup', async t => {
  const title = '<img src=x onerror="window.PWNED=true">';
  const essay = 'Primeiro parágrafo com <img src=x onerror="window.PWNED=true">.\n\nSegundo parágrafo com <script>window.PWNED=true</script>.';
  const { page } = await fixture(t, {
    content: '<label for="host-title">Título da redação</label><input id="host-title"><div id="host-essay" contenteditable="true" role="textbox" aria-label="Texto da redação"><p>Rascunho anterior.</p></div>',
    api: route => json(route, 200, completion(title, essay)),
  });
  await generate(page);
  assert.equal(await page.locator('#host-title').inputValue(), title);
  assert.equal(await page.locator('#host-essay').innerText(), essay);
  assert.equal(await page.locator('#host-essay img, #host-essay script').count(), 0);
  assert.equal(await page.evaluate(() => window.PWNED), undefined);
  await assertResult(page, title, essay);
});

test('uses native value setters and bubbling input/change events to update controlled fields', async t => {
  const behavior = `window.controlledState={};window.controlledChanges=[];
    const fields=[['title',document.querySelector('[data-host-title]')],['essay',document.querySelector('[data-host-essay]')]];
    const native=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
    const trackers=new Map();
    for(const [key,node] of fields){
      let tracked=native.get.call(node);window.controlledState[key]=tracked;
      Object.defineProperty(node,'value',{configurable:true,get(){return native.get.call(this)},set(value){tracked=String(value);native.set.call(this,value)}});
      trackers.set(node,{get:()=>tracked,set:value=>{tracked=value}});
      node.addEventListener('change',()=>window.controlledChanges.push(key));
    }
    function render(){
      const rendered={...window.controlledState};
      for(const [key,node] of fields){
        node.value=rendered[key];
        node.oninput=()=>{
          const actual=native.get.call(node);const tracker=trackers.get(node);
          if(actual===tracker.get())return;
          tracker.set(actual);
          const next={...rendered,[key]:actual};
          setTimeout(()=>{window.controlledState=next;render()},0);
        };
      }
    }
    render();`;
  const { page } = await fixture(t, { behavior });
  await generate(page);
  await page.waitForFunction(({ title, essay }) => window.controlledState.title === title && window.controlledState.essay === essay, { title: TITLE, essay: ESSAY }, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.controlledState), { title: TITLE, essay: ESSAY });
  assert.deepEqual(await hostDraft(page), { title: TITLE, essay: ESSAY });
  assert.deepEqual(await page.evaluate(() => window.controlledChanges.sort()), ['essay', 'title']);
  const events = await page.evaluate(() => window.hostEvents);
  for (const id of [':r17:', ':r18:']) {
    assert.deepEqual(events.filter(event => event.id === id).map(event => event.kind).sort(), ['change', 'input']);
  }
});

test('ignores hidden, readonly, password, search, and reference controls when locating targets', async t => {
  const decoys = `<input id="hidden-title" aria-label="Título da redação" hidden value="Oculto">
    <textarea id="hidden-essay" aria-label="Redação" style="display:none">Oculta</textarea>
    <input id="readonly-title" aria-label="Título" readonly value="Somente leitura">
    <textarea id="readonly-essay" aria-label="Redação" readonly>Texto de leitura</textarea>
    <input id="password" type="password" aria-label="Título" value="Senha secreta">
    <input id="search" type="search" aria-label="Título" value="Minha pesquisa">
    <label for="reference">Texto de referência</label><textarea id="reference">Fonte que deve permanecer intacta.</textarea>`;
  const { page } = await fixture(t, { content: standardForm(decoys) });
  const beforeValues = await page.locator('#hidden-title, #hidden-essay, #readonly-title, #readonly-essay, #password, #search, #reference').evaluateAll(nodes => nodes.map(node => [node.id, node.value]));
  await generate(page);
  assert.deepEqual(await hostDraft(page), { title: TITLE, essay: ESSAY });
  assert.deepEqual(await page.locator('#hidden-title, #hidden-essay, #readonly-title, #readonly-essay, #password, #search, #reference').evaluateAll(nodes => nodes.map(node => [node.id, node.value])), beforeValues);
});

const ambiguousFields = `<label for="title-one">Título da redação</label><input id="title-one" value="Título um">
  <label for="title-two">Título da redação</label><input id="title-two" value="Título dois">
  <label for="essay-one">Texto da redação</label><textarea id="essay-one">Rascunho um</textarea>
  <label for="essay-two">Texto da redação</label><textarea id="essay-two">Rascunho dois</textarea>`;

test('leaves ambiguous editors intact and presents an actionable choice with the generated result', async t => {
  const { page } = await fixture(t, { content: ambiguousFields });
  await generate(page);
  assert.deepEqual(await page.locator('main input, main textarea').evaluateAll(nodes => nodes.map(node => node.value)), ['Título um', 'Título dois', 'Rascunho um', 'Rascunho dois']);
  await assertResult(page);
  assert.equal(await control(page, 'pick-title').isVisible(), true);
  assert.equal(await control(page, 'pick-essay').isVisible(), true);
  assert.match(await resultMessage(page), /selecion|escolh|campo|preench/i);
});

test('allows choosing title and essay targets manually and retrying without another API request', async t => {
  const { page, requests } = await fixture(t, { content: ambiguousFields });
  await generate(page);
  await control(page, 'pick-title').click();
  await page.locator('#title-two').click();
  await control(page, 'pick-essay').click();
  await page.locator('#essay-two').click();
  await control(page, 'fill-page').click();
  await page.waitForFunction(({ title, essay }) => document.getElementById('title-two').value === title && document.getElementById('essay-two').value === essay, { title: TITLE, essay: ESSAY }, { timeout: 5000 });
  assert.equal(await page.locator('#title-two').inputValue(), TITLE);
  assert.equal(await page.locator('#essay-two').inputValue(), ESSAY);
  assert.equal(await page.locator('#title-one').inputValue(), 'Título um');
  assert.equal(await page.locator('#essay-one').inputValue(), 'Rascunho um');
  assert.equal(requests.length, 1);
  await assertResult(page);
});

test('fills an available title while preserving the essay in results when the page lacks an essay target', async t => {
  const { page } = await fixture(t, { content: '<label for="host-title">Título da redação</label><input id="host-title" value="Rascunho">' });
  await generate(page);
  assert.equal(await page.locator('#host-title').inputValue(), TITLE);
  await assertResult(page);
  assert.equal(await control(page, 'pick-essay').isVisible(), true);
  assert.match(await resultMessage(page), /campo|redação|selecion|preench/i);
});

test('fills an available essay while preserving the title in results when the page lacks a title target', async t => {
  const { page } = await fixture(t, { content: `<label for="host-essay">Texto da redação</label><textarea id="host-essay">${ORIGINAL_ESSAY}</textarea>` });
  await generate(page);
  assert.equal(await page.locator('#host-essay').inputValue(), ESSAY);
  await assertResult(page);
  assert.equal(await control(page, 'pick-title').isVisible(), true);
  assert.match(await resultMessage(page), /campo|título|selecion|preench/i);
});

test('keeps the existing host draft unchanged after an API failure', async t => {
  const { page } = await fixture(t, { api: route => json(route, 500, { error: { message: 'Serviço temporariamente indisponível.' } }) });
  await generate(page);
  assert.deepEqual(await hostDraft(page), { title: ORIGINAL_TITLE, essay: ORIGINAL_ESSAY });
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
  assert.match(await control(page, 'status').textContent(), /erro|servidor|serviço|indispon|500/i);
});

test('cancels a pending response without changing the draft even if the response arrives later', async t => {
  const release = deferred();
  t.after(() => release.resolve());
  const { page } = await fixture(t, { api: async route => {
    await release.promise;
    await json(route, 200, completion()).catch(() => {});
  } });
  const pendingRequest = page.waitForRequest(API_URL, { timeout: 5000 });
  await control(page, 'generate').click();
  await pendingRequest;
  await control(page, 'cancel').click();
  await ready(page);
  release.resolve();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await hostDraft(page), { title: ORIGINAL_TITLE, essay: ORIGINAL_ESSAY });
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
  assert.match(await control(page, 'status').textContent(), /cancelad|interrompid/i);
});

test('cancels between automatic title and essay updates and restores the original draft', async t => {
  const behavior = `window.fillCancellationCount=0;
    document.querySelector('[data-host-title]').addEventListener('input',()=>{
      if(window.fillCancellationCount)return;
      window.fillCancellationCount++;
      setTimeout(()=>{
        const root=document.getElementById('redator-groq-console').shadowRoot;
        window.cancellationSnapshot={
          title:document.querySelector('[data-host-title]').value,
          essay:document.querySelector('[data-host-essay]').value,
          busy:root.getElementById('generate').disabled,
          cancelVisible:!root.getElementById('cancel').hidden
        };
        root.getElementById('cancel').click();
      },0);
    });`;
  const { page } = await fixture(t, { behavior });
  await generate(page);
  assert.deepEqual(await page.evaluate(() => window.cancellationSnapshot), {
    title: TITLE, essay: ORIGINAL_ESSAY, busy: true, cancelVisible: true,
  });
  assert.equal(await page.evaluate(() => window.fillCancellationCount), 1);
  assert.deepEqual(await hostDraft(page), { title: ORIGINAL_TITLE, essay: ORIGINAL_ESSAY });
  assert.deepEqual(await page.evaluate(() => window.hostEvents.filter(event => event.id === ':r18:')), []);
  assert.match(await control(page, 'status').textContent(), /cancelad|interrompid/i);
});

test('retains truncated output in the result pane without overwriting the host draft', async t => {
  const partial = 'Uma introdução interrompida antes de terminar';
  const { page } = await fixture(t, { api: route => json(route, 200, completion(TITLE, partial, 'length')) });
  await generate(page);
  assert.deepEqual(await hostDraft(page), { title: ORIGINAL_TITLE, essay: ORIGINAL_ESSAY });
  assert.deepEqual(await page.evaluate(() => window.hostEvents), []);
  await assertResult(page, TITLE, partial);
  assert.match(await control(page, 'status').textContent(), /limite|truncad|incomplet|interrompid/i);
});

test('fills a same-origin TinyMCE iframe editor and its separate title field', async t => {
  const { page } = await fixture(t, {
    content: '<label for="host-title">Título da redação</label><input id="host-title"><label id="essay-label">Texto da redação</label><iframe id="essay_ifr" class="tox-edit-area__iframe" title="Texto da redação" aria-labelledby="essay-label" src="/editor.html"></iframe>',
    iframe: '<!doctype html><html><head><title>Editor</title></head><body id="tinymce" class="mce-content-body" contenteditable="true" aria-label="Texto da redação"><p>Rascunho no editor.</p></body></html>',
  });
  await page.frameLocator('#essay_ifr').locator('#tinymce').waitFor();
  await generate(page);
  assert.equal(await page.locator('#host-title').inputValue(), TITLE);
  assert.equal(await page.frameLocator('#essay_ifr').locator('#tinymce').innerText(), ESSAY);
  await assertResult(page);
});
