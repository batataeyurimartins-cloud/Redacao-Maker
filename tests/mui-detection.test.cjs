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
const ORIGINAL = ['Meu título em elaboração', 'Meu rascunho ainda está em elaboração.'];
const IDS = ['a7b6c5d4', 'e3f2g1h0'];
const test = (name, run) => nodeTest(name, { timeout: 30000 }, run);

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

// The real controls deliberately have the same opaque attributes and height.
// Neither their IDs nor their generated CSS class names identify their role.
function muiField(index, caption = '', options = {}) {
  const tag = options.tag || (index === 0 ? 'p' : 'span');
  const label = caption ? `<${tag} class="MuiTypography-root MuiTypography-body1">${caption}</${tag}>` : '';
  return `<div class="MuiFormControl-root">${label}<div class="MuiInputBase-root MuiInputBase-multiline">
    <textarea aria-invalid="false" id="${options.id || IDS[index]}" class="MuiInputBase-input MuiInputBase-inputMultiline css-1ji6r31" style="height:46px;${options.style || ''}"${options.attributes || ''}>${options.value ?? ORIGINAL[index]}</textarea>
    <textarea aria-hidden="true" tabindex="-1" readonly class="MuiInputBase-input MuiInputBase-inputMultiline css-1ji6r31" style="visibility:hidden;position:absolute;overflow:hidden;height:0;padding:0;border:0">Espelho oculto ${index}</textarea>
    </div></div>`;
}

function muiPair(captions = ['Titulo', 'Redação']) {
  return `<form id="activity">${muiField(0, captions[0])}${muiField(1, captions[1])}<button type="submit">Enviar redação</button></form>`;
}

function documentWith(content, behavior = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Atividade escolar</title>
    <link rel="icon" href="data:,"><style>
    body{margin:24px;font:16px sans-serif}main{width:480px}.MuiFormControl-root{display:block;margin:16px 0}
    .MuiTypography-root{display:block;margin:0 0 6px}.MuiInputBase-root{position:relative;border:1px solid #888;padding:6px}
    textarea{display:block;width:440px;box-sizing:border-box;resize:none}button{margin-top:12px}
    </style></head><body><main><h1>Atividade</h1><p>Bibliotecas públicas ampliam o acesso ao conhecimento.</p>${content}</main>
    <script>window.hostEvents=[];window.hostSubmits=0;window.hostClicks=0;
    document.addEventListener('submit',event=>{event.preventDefault();window.hostSubmits++});
    document.addEventListener('click',event=>{if(event.target.closest('main button'))window.hostClicks++});
    for(const kind of ['input','change'])document.addEventListener(kind,event=>{if(event.target.closest('main'))window.hostEvents.push({kind,id:event.target.id,value:event.target.value})});
    ${behavior}</script></body></html>`;
}

function control(page, id) {
  return page.locator(`#redator-groq-console >> #${id}`);
}

async function fixture(t, { content = muiPair(), behavior = '', origin = ORIGIN, routePath = '/atividade/fixture?eRedacao=true' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(5000);
  const requests = [];
  const unexpected = [];
  let page;
  t.after(async () => {
    if (page && !page.isClosed()) {
      assert.deepEqual(await page.evaluate(() => ({ submits: window.hostSubmits, clicks: window.hostClicks })), { submits: 0, clicks: 0 });
    }
    await context.close();
    assert.deepEqual(unexpected, [], 'fixtures must never contact a provider or school service');
    assert.equal(requests.length, 1, 'target discovery must not request another generation');
  });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url() === `${origin}${routePath}`) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: documentWith(content, behavior) });
    }
    if (request.url() === API_URL) {
      for (const name of ['authorization', 'x-api-key', 'api-key', 'x-access-token', 'x-hub-token']) {
        assert.equal(request.headers()[name], undefined, `public requests must not contain ${name}`);
      }
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      assert.equal(request.method(), 'POST');
      requests.push(request.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', headers,
        body: JSON.stringify({ title: TITLE, choices: [{ message: { role: 'assistant', content: ESSAY }, finish_reason: 'stop' }] }) });
    }
    unexpected.push(request.url());
    return route.abort();
  });
  page = await context.newPage();
  await page.goto(`${origin}${routePath}`);
  await page.addScriptTag({ content: script });
  await page.locator('#redator-groq-console').waitFor();
  await control(page, 'open-source').click();
  await control(page, 'context').fill('Bibliotecas públicas oferecem acesso gratuito à internet e formação digital.');
  await control(page, 'save-source').click();
  return page;
}

async function generate(page) {
  if (await control(page, 'secondary-panel').isVisible()) await control(page, 'secondary-close').click();
  const response = page.waitForResponse(API_URL, { timeout: 5000 });
  await control(page, 'generate').click();
  await response;
  await page.waitForFunction(() => !document.getElementById('redator-groq-console').shadowRoot.getElementById('generate').disabled, null, { timeout: 5000 });
  assert.equal(await control(page, 'result-title').inputValue(), TITLE);
  assert.equal(await control(page, 'result').inputValue(), ESSAY);
}

async function realValues(page) {
  return page.locator('main textarea[aria-invalid="false"]').evaluateAll(nodes => nodes.map(node => node.value));
}

test('recognizes short MUI Typography labels beside identical textareas and ignores autosize mirrors', async t => {
  const page = await fixture(t);
  const mirrors = await page.locator('main textarea[readonly]').evaluateAll(nodes => nodes.map(node => node.value));
  await generate(page);
  assert.deepEqual(await realValues(page), [TITLE, ESSAY]);
  assert.deepEqual(await page.locator('main textarea[readonly]').evaluateAll(nodes => nodes.map(node => node.value)), mirrors);
  assert.deepEqual(await page.evaluate(() => window.hostEvents.map(event => [event.kind, event.id])), [
    ['input', IDS[0]], ['change', IDS[0]], ['input', IDS[1]], ['change', IDS[1]],
  ]);
});

test('uses explicit aria labels under a general Proposta de redação heading', async t => {
  const content = `<section><form id="activity"><h2>Proposta de redação</h2>
    ${muiField(0, '', { attributes: ' aria-label="Título"' })}${muiField(1, '', { attributes: ' aria-label="Redação"' })}
    <button type="submit">Enviar redação</button></form></section>`;
  const page = await fixture(t, { content });
  await generate(page);
  assert.deepEqual(await realValues(page), [TITLE, ESSAY]);
});

test('rediscovers semantic MUI targets after React replaces nodes and changes opaque IDs and CSS hashes', async t => {
  const behavior = `window.hostReplacements=0;
    document.getElementById('${IDS[0]}').addEventListener('input',()=>setTimeout(()=>{
      const previous=document.getElementById('activity');
      const values=[...previous.querySelectorAll('textarea[aria-invalid="false"]')].map(node=>node.value);
      const next=previous.cloneNode(true);
      [...next.querySelectorAll('textarea[aria-invalid="false"]')].forEach((node,index)=>{
        node.id=['z9y8x7w6','v5u4t3s2'][index];
        node.className='MuiInputBase-input MuiInputBase-inputMultiline css-'+crypto.randomUUID().replaceAll('-','').slice(0,7);
        node.value=values[index];
      });
      previous.replaceWith(next);window.hostReplacements++;
    },0),{once:true});`;
  const page = await fixture(t, { behavior });
  await generate(page);
  assert.equal(await page.evaluate(() => window.hostReplacements), 1);
  assert.equal(await page.locator(`#${IDS[0]},#${IDS[1]}`).count(), 0);
  assert.deepEqual(await realValues(page), [TITLE, ESSAY]);
  assert.deepEqual(await page.locator('main textarea[aria-invalid="false"]').evaluateAll(nodes => nodes.map(node => node.id)), ['z9y8x7w6', 'v5u4t3s2']);
  assert.deepEqual(await page.evaluate(() => window.hostEvents.filter(event => event.kind === 'input').map(event => event.id)), [IDS[0], 'v5u4t3s2']);
});

test('preserves reference, support, and comment controls and refuses duplicate MUI field pairs', async t => {
  const decoys = [
    muiField(0, 'Título do texto de apoio', { id: 'j1k2l3m4', value: 'Título da fonte' }),
    muiField(1, 'Texto de referência', { id: 'n5o6p7q8', value: 'Fonte para consulta.' }),
    muiField(1, 'Comentário sobre a redação', { id: 'r9s8t7u6', value: 'Comentário do professor.' }),
  ].join('');
  const page = await fixture(t, { content: muiPair() + `<aside>${decoys}</aside>` });
  await generate(page);
  assert.deepEqual(await realValues(page), [TITLE, ESSAY, 'Título da fonte', 'Fonte para consulta.', 'Comentário do professor.']);

  const ambiguous = await fixture(t, { content: `<form>${muiField(0, 'Titulo')}${muiField(1, 'Redação')}
    ${muiField(0, 'Titulo', { id: 'i8j7k6l5', value: 'Outro título' })}${muiField(1, 'Redação', { id: 'm4n3o2p1', value: 'Outra redação.' })}</form>` });
  await generate(ambiguous);
  assert.deepEqual(await realValues(ambiguous), [...ORIGINAL, 'Outro título', 'Outra redação.']);
  assert.deepEqual(await ambiguous.evaluate(() => window.hostEvents), []);
  assert.equal(await control(ambiguous, 'pick-title').isVisible(), true);
  assert.equal(await control(ambiguous, 'pick-essay').isVisible(), true);
});

test('limits the unlabeled two-MUI-textarea order fallback to one local Sala do Futuro editor', async t => {
  const pair = `<h2>Proposta de redação</h2><section class="MuiBox-root">${muiField(0)}${muiField(1)}</section>`;
  const page = await fixture(t, { origin: SALA_ORIGIN, content: pair });
  await generate(page);
  assert.deepEqual(await realValues(page), [TITLE, ESSAY]);

  const scenarios = [
    { name: 'unrelated host', origin: ORIGIN, content: pair, values: ORIGINAL },
    { name: 'lookalike host', origin: 'https://saladofuturo.educacao.sp.gov.br.fixture.test', content: pair, values: ORIGINAL },
    { name: 'school home page', origin: SALA_ORIGIN, routePath: '/', content: pair, values: ORIGINAL },
    { name: 'more than two controls', origin: SALA_ORIGIN, content: `<section class="MuiBox-root">${muiField(0)}${muiField(1)}${muiField(1, '', { id: 'q1r2s3t4', value: 'Outro campo.' })}</section>`, values: [...ORIGINAL, 'Outro campo.'] },
    { name: 'separate editors', origin: SALA_ORIGIN, content: `<form>${muiField(0)}</form><form>${muiField(1)}</form>`, values: ORIGINAL },
    { name: 'generic short MUI control beside a known title', origin: ORIGIN,
      content: `<form><label for="u1v2w3x4">Título</label><input id="u1v2w3x4" value="Título genérico">${muiField(1)}</form>`,
      values: [ORIGINAL[1]], allowedEventId: 'u1v2w3x4' },
    { name: 'semantic title outside the Sala pair', origin: SALA_ORIGIN,
      content: `<label for="u1v2w3x4">Título</label><input id="u1v2w3x4" value="Título externo">${pair}`,
      values: ORIGINAL, extraValues: [['#u1v2w3x4', 'Título externo']] },
    { name: 'semantic essay outside the Sala pair', origin: SALA_ORIGIN,
      content: `<label for="y5z6a7b8">Redação</label><textarea id="y5z6a7b8">Redação externa.</textarea>${pair}`,
      values: ORIGINAL, extraValues: [['#y5z6a7b8', 'Redação externa.']] },
    { name: 'reference heading on the Sala activity', origin: SALA_ORIGIN,
      content: `<h2>Textos de Apoio</h2><section class="MuiBox-root">${muiField(0)}${muiField(1)}</section>`, values: ORIGINAL },
  ];
  for (const scenario of scenarios) {
    const untouched = await fixture(t, scenario);
    await generate(untouched);
    assert.deepEqual(await realValues(untouched), scenario.values, scenario.name);
    assert.deepEqual(await untouched.evaluate(allowedId => window.hostEvents.filter(event => event.id !== allowedId), scenario.allowedEventId || null), [], scenario.name);
    for (const [selector, value] of scenario.extraValues || []) {
      assert.equal(await untouched.locator(selector).inputValue(), value, scenario.name);
    }
    assert.equal(await control(untouched, 'pick-title').isVisible(), true, scenario.name);
    assert.equal(await control(untouched, 'pick-essay').isVisible(), true, scenario.name);
  }
});

test('tolerates Sala ancestor aria-hidden metadata while keeping actual hidden controls and other hosts excluded', async t => {
  const hidden = `<section style="display:none">${muiField(0, 'Titulo', { id: 'b1c2d3e4', value: 'Título oculto' })}${muiField(1, 'Redação', { id: 'f5g6h7i8', value: 'Redação oculta.' })}</section>
    <section style="visibility:hidden">${muiField(1, 'Redação', { id: 'j9k8l7m6', value: 'Texto invisível.' })}</section>
    <section style="opacity:0">${muiField(1, 'Redação', { id: 'n5o4p3q2', value: 'Texto transparente.' })}</section>
    ${muiField(1, 'Redação', { id: 'r1s2t3u4', value: 'Campo com aria-hidden próprio.', attributes: ' aria-hidden="true"' })}`;
  const page = await fixture(t, { origin: SALA_ORIGIN, content: `<section aria-hidden="true">${muiPair()}</section>${hidden}` });
  await generate(page);
  assert.deepEqual(await realValues(page), [TITLE, ESSAY, 'Título oculto', 'Redação oculta.', 'Texto invisível.', 'Texto transparente.', 'Campo com aria-hidden próprio.']);
  assert.deepEqual(await page.evaluate(() => window.hostEvents.filter(event => event.kind === 'input').map(event => event.id)), IDS);

  for (const options of [{ origin: ORIGIN }, { origin: SALA_ORIGIN, routePath: '/' }]) {
    const excluded = await fixture(t, { ...options, content: `<section aria-hidden="true">${muiPair()}</section>` });
    await generate(excluded);
    assert.deepEqual(await realValues(excluded), ORIGINAL);
    assert.deepEqual(await excluded.evaluate(() => window.hostEvents), []);
  }
});
