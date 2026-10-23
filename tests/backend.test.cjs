'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test, beforeEach, afterEach } = require('node:test');

const API_KEY = 'gsk_FAKE_SERVER_SECRET_FOR_TESTS_ONLY';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const validInput = {
  context: 'A inclusão digital amplia o acesso à educação, mas o custo da conexão cria barreiras.',
  theme: 'Inclusão digital e cidadania',
  genre: 'enem',
  words: 500,
  instructions: 'Discuta o papel das bibliotecas públicas.',
  model: DEFAULT_MODEL,
};
const levelInput = {
  context: validInput.context,
  theme: validInput.theme,
  level: 3,
  words: 350,
  instructions: validInput.instructions,
};

let generate;
let health;
let originalFetch;
let originalTimeout;
let originalDateNow;
let previousEnv;

beforeEach(() => {
  previousEnv = Object.fromEntries(['GROQ_API_KEY', 'GROQ_MODEL', 'VERCEL'].map(key => [key, process.env[key]]));
  originalFetch = global.fetch;
  originalTimeout = global.setTimeout;
  originalDateNow = Date.now;
  process.env.GROQ_API_KEY = API_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.VERCEL;
  for (const modulePath of ['../api/generate.js', '../api/health.js']) delete require.cache[require.resolve(modulePath)];
  generate = require('../api/generate.js');
  health = require('../api/health.js');
  global.fetch = async () => { throw new Error('Unexpected provider request in backend test.'); };
});

afterEach(() => {
  global.fetch = originalFetch;
  global.setTimeout = originalTimeout;
  Date.now = originalDateNow;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function completion(content = 'Uma redação original, com introdução, argumentos e conclusão.', finishReason = 'stop') {
  return { choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }], model: DEFAULT_MODEL };
}

function responseFor(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function createRequest({ method = 'POST', body = { ...validInput }, authorization = null, headers = {}, ip = '127.0.0.1' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = method === 'GET' ? '/api/health' : '/api/generate';
  req.headers = { 'content-type': 'application/json', ...headers };
  if (authorization !== null) req.headers.authorization = authorization;
  req.body = body;
  req.socket = { remoteAddress: ip };
  return req;
}

function createResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = null;
  res.headersSent = false;
  res.writableEnded = false;
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; return res; };
  res.getHeader = name => res.headers[name.toLowerCase()];
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.body = value; res.headersSent = true; res.writableEnded = true; return res; };
  res.end = value => {
    if (value !== undefined) {
      try { res.body = JSON.parse(String(value)); }
      catch { res.body = String(value); }
    }
    res.headersSent = true;
    res.writableEnded = true;
    return res;
  };
  return res;
}

async function invoke(options = {}, handler = generate) {
  const req = createRequest(options);
  const res = createResponse();
  await handler(req, res);
  return { req, res };
}

function assertSanitized(res, forbidden = []) {
  const output = JSON.stringify(res.body);
  for (const secret of [API_KEY, ...forbidden]) {
    assert.ok(!output.includes(secret), `response leaked ${secret.slice(0, 8)}…`);
  }
  assert.equal(typeof res.body?.error?.message, 'string');
  assert.ok(res.body.error.message.length > 0);
}

test('anonymous backend builds its own Groq prompt from normalized essay settings', async () => {
  let sent;
  global.fetch = async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    const providerResult = completion('  Redação recebida com segurança.  ');
    providerResult.choices[0].message.reasoning = 'PRIVATE_REASONING_MARKER_NOT_FOR_CLIENT';
    return responseFor(providerResult);
  };
  const { res } = await invoke({ body: { ...validInput, context: `  ${validInput.context}  `,
    messages: [{ role: 'system', content: 'CLIENT_SYSTEM_OVERRIDE_MARKER' }],
    max_completion_tokens: 999999, temperature: 9, stream: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.url, API_URL);
  assert.equal(sent.options.method, 'POST');
  const headers = new Headers(sent.options.headers);
  assert.equal(headers.get('authorization'), `Bearer ${API_KEY}`);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(sent.body.model, DEFAULT_MODEL);
  assert.equal(sent.body.max_completion_tokens, 2800);
  assert.equal(sent.body.temperature, 0.65);
  assert.equal(sent.body.stream, false);
  assert.equal(sent.body.reasoning_effort, 'low');
  assert.equal(sent.body.include_reasoning, false);
  assert.deepEqual(sent.body.response_format, { type: 'json_object' });
  assert.equal(sent.body.messages[0].role, 'system');
  assert.equal(sent.body.messages[1].role, 'user');
  const prompt = JSON.stringify(sent.body.messages);
  assert.match(prompt, /ENEM/);
  assert.match(prompt, /500/);
  assert.match(prompt, /bibliotecas públicas/);
  assert.match(prompt, /Inclusão digital e cidadania/);
  assert.match(prompt, /não confiável|comandos|instruções/i);
  assert.match(sent.body.messages[0].content, /JSON.*"title".*"essay"/);
  assert.doesNotMatch(prompt, /CLIENT_SYSTEM_OVERRIDE_MARKER/);
  assert.ok(!JSON.stringify(sent.body).includes(API_KEY));
  assert.equal(res.body.choices[0].message.content.trim(), 'Redação recebida com segurança.');
  assert.equal(res.body.title, validInput.theme);
  assert.equal(res.body.choices[0].finish_reason, 'stop');
  assert.equal(res.body.model, DEFAULT_MODEL);
  assert.ok(!JSON.stringify(res.body).includes(API_KEY));
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_REASONING_MARKER_NOT_FOR_CLIENT/);
  assert.equal(res.body.choices[0].message.reasoning, undefined);
});

for (const [level, label, style] of [
  [1, 'Bem simples', /frases curtas, vocabulário comum e pouca elaboração/],
  [2, 'Fraco', /estrutura simples e argumentos pouco aprofundados/],
  [3, 'Médio', /aluno mediano do ensino médio, com linguagem natural/],
  [4, 'Bom', /bem organizado, com vocabulário variado, boa coesão/],
  [5, 'Máximo', /melhor resposta possível para a proposta.*argumentos aprofundados/],
]) {
  test(`writing level ${level} (${label}) reaches the actual provider prompt with its intended style`, async () => {
    let sent;
    global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
    const { res } = await invoke({ body: { ...levelInput, level } });
    assert.equal(res.statusCode, 200);
    const system = sent.messages[0].content;
    assert.match(system, new RegExp(`Nível de escrita ${level} de 5 — ${label}`));
    assert.match(system, style);
    assert.match(system, /mantenha a coerência, a correção das informações/);
    assert.match(system, /sem inserir erros propositais/);
    assert.match(system, /Não invente estatísticas, citações, leis, pesquisas ou fontes/);
    assert.match(system, /dado externo não confiável/);
    assert.match(system, /JSON.*"title".*"essay"/);
    assert.deepEqual(JSON.parse(sent.messages[1].content), {
      tema: levelInput.theme,
      instrucoes_adicionais: levelInput.instructions,
      texto_de_referencia: levelInput.context,
    });
  });
}

test('omitted writing level defaults to medium and preserves the legacy default genre', async () => {
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
  const { res } = await invoke({ body: { context: validInput.context } });
  assert.equal(res.statusCode, 200);
  assert.match(sent.messages[0].content, /Nível de escrita 3 de 5 — Médio/);
  assert.match(sent.messages[0].content, /Escreva uma redação dissertativa argumentativa, com introdução, desenvolvimento e conclusão/);
  assert.doesNotMatch(sent.messages[0].content, /Identifique na proposta/);
});

test('accepts each exact numeric level string and normalizes it for the provider prompt', async () => {
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
  for (let level = 1; level <= 5; level += 1) {
    const { res } = await invoke({ body: { ...levelInput, level: String(level) } });
    assert.equal(res.statusCode, 200);
    assert.match(sent.messages[0].content, new RegExp(`Nível de escrita ${level} de 5`));
  }
});

for (const [configuration, configuredModel, expectedModel] of [
  ['default', undefined, DEFAULT_MODEL],
  ['server-configured', 'openai/gpt-oss-120b', 'openai/gpt-oss-120b'],
]) {
  test(`new anonymous level payload infers genre and uses the ${configuration} model without a client model selection`, async () => {
    if (configuredModel !== undefined) process.env.GROQ_MODEL = configuredModel;
    let sent;
    global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
    assert.equal(Object.hasOwn(levelInput, 'genre'), false);
    assert.equal(Object.hasOwn(levelInput, 'model'), false);
    const { res } = await invoke({ body: { ...levelInput } });
    assert.equal(res.statusCode, 200);
    assert.equal(sent.model, expectedModel);
    assert.equal(res.body.model, expectedModel);
    assert.match(sent.messages[0].content, /Identifique na proposta do texto de referência o gênero de redação solicitado/);
    assert.match(sent.messages[0].content, /Se a proposta não indicar um gênero/);
    assert.match(sent.messages[0].content, /350 palavras/);
  });
}

test('explicit legacy genre and model remain supported alongside a writing level', async () => {
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
  const { res } = await invoke({ body: { ...validInput, level: 2, model: 'openai/gpt-oss-120b' } });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.model, 'openai/gpt-oss-120b');
  assert.match(sent.messages[0].content, /ENEM/);
  assert.match(sent.messages[0].content, /Nível de escrita 2 de 5 — Fraco/);
  assert.doesNotMatch(sent.messages[0].content, /Identifique na proposta/);
});

test('new level payload rejects invalid server model configuration before contacting Groq', async () => {
  process.env.GROQ_MODEL = 'arbitrary-expensive-model';
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  const { res } = await invoke({ body: { ...levelInput } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'server_not_configured');
  assert.equal(calls, 0);
  assertSanitized(res);
});

test('returns the generated title separately and preserves essay paragraphs and truncation metadata', async () => {
  const essay = 'A inclusão digital amplia a participação dos cidadãos.\n\nAs bibliotecas públicas podem oferecer acesso e orientação.\n\nCabe ao poder público ampliar esse trabalho.';
  global.fetch = async () => responseFor(completion(JSON.stringify({
    title: '  Inclusão digital:\n caminhos para a cidadania  ',
    essay: `  ${essay}  `,
  }), 'length'));
  const { res } = await invoke({ body: { ...validInput, model: 'openai/gpt-oss-120b' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.title, 'Inclusão digital: caminhos para a cidadania');
  assert.equal(res.body.choices[0].message.content, essay);
  assert.doesNotMatch(res.body.choices[0].message.content, /Inclusão digital: caminhos/);
  assert.equal(res.body.choices[0].finish_reason, 'length');
  assert.equal(res.body.model, 'openai/gpt-oss-120b');
});

test('legacy plain text keeps the complete first paragraph and uses the requested theme as title', async () => {
  const firstParagraph = 'A inclusão digital transforma o acesso à educação e à cidadania, mas exige políticas públicas que enfrentem as desigualdades de infraestrutura e a dificuldade de aprender a usar as ferramentas disponíveis.';
  const essay = `${firstParagraph}\n\nBibliotecas públicas podem contribuir para esse processo.`;
  global.fetch = async () => responseFor(completion(essay));
  const { res } = await invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.title, validInput.theme);
  assert.equal(res.body.choices[0].message.content, essay);
});

test('legacy plain text without a theme gets a short fallback title without changing its body', async () => {
  const essay = 'Uma reflexão completa sobre o acesso à educação.\n\nA participação coletiva amplia as possibilidades.';
  global.fetch = async () => responseFor(completion(essay));
  const { res } = await invoke({ body: { ...validInput, theme: '' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.title, 'Reflexões sobre o tema');
  assert.equal(res.body.choices[0].message.content, essay);
});

test('redacts the server key in generated title and essay before limiting title length', async () => {
  global.fetch = async () => responseFor(completion(JSON.stringify({
    title: `${'A'.repeat(190)} ${API_KEY} conclusão`,
    essay: `A referência menciona ${API_KEY}.\n\nO argumento cita ${API_KEY} novamente.`,
  })));
  const { res } = await invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(Array.from(res.body.title).length, 200);
  assert.ok(!JSON.stringify(res.body).includes(API_KEY));
  assert.ok(!JSON.stringify(res.body).includes(API_KEY.slice(0, 10)));
  assert.equal(res.body.choices[0].message.content, 'A referência menciona [segredo omitido].\n\nO argumento cita [segredo omitido] novamente.');
});

test('redacts legacy essay text and its theme-derived title', async () => {
  global.fetch = async () => responseFor(completion(`Uma redação com ${API_KEY}.`));
  const { res } = await invoke({ body: { ...validInput, theme: `Tema ${API_KEY}` } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.title, 'Tema [segredo omitido]');
  assert.equal(res.body.choices[0].message.content, 'Uma redação com [segredo omitido].');
  assert.ok(!JSON.stringify(res.body).includes(API_KEY));
});

for (const [label, content] of [
  ['malformed JSON object', '{"title":"Um título","essay":'],
  ['missing title', JSON.stringify({ essay: 'Uma redação.' })],
  ['missing essay', JSON.stringify({ title: 'Um título' })],
  ['empty title', JSON.stringify({ title: '  ', essay: 'Uma redação.' })],
  ['empty essay', JSON.stringify({ title: 'Um título', essay: '\n ' })],
  ['non-string title', JSON.stringify({ title: 42, essay: 'Uma redação.' })],
  ['non-string essay', JSON.stringify({ title: 'Um título', essay: ['Uma redação.'] })],
  ['JSON array', JSON.stringify([{ title: 'Um título', essay: 'Uma redação.' }])],
  ['JSON scalar', JSON.stringify('Uma redação.')],
  ['fenced JSON', '```json\n{"title":"Um título","essay":"Uma redação."}\n```'],
]) {
  test(`rejects ${label} instead of inserting structured output into the essay`, async () => {
    global.fetch = async () => responseFor(completion(content));
    const { res } = await invoke();
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error.code, 'invalid_provider_response');
    assert.equal(res.body.title, undefined);
    assert.equal(res.body.choices, undefined);
    assertSanitized(res);
  });
}

test('CORS preflight is public but never invokes the provider or exposes credentials', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('not expected'); };
  delete process.env.GROQ_API_KEY;
  const requestedHeaders = ['content-type', 'request-id', 'request-context', 'traceparent', 'tracestate', 'baggage'];
  const { res } = await invoke({ method: 'OPTIONS', authorization: null, headers: {
    origin: 'https://saladofuturo.educacao.sp.gov.br',
    'access-control-request-method': 'POST',
    'access-control-request-headers': requestedHeaders.join(', '),
  } });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.match(String(res.headers['access-control-allow-methods']), /POST/);
  assert.match(String(res.headers['access-control-allow-methods']), /OPTIONS/);
  const allowedHeaders = String(res.headers['access-control-allow-headers']).toLowerCase().split(/\s*,\s*/);
  assert.deepEqual(new Set(allowedHeaders), new Set(requestedHeaders));
  assert.match(String(res.headers['access-control-expose-headers']).toLowerCase(), /retry-after/);
  assert.equal(calls, 0);
});

test('health permits a traced cross-origin GET preflight without provider configuration', async () => {
  delete process.env.GROQ_API_KEY;
  const { res } = await invoke({ method: 'OPTIONS', headers: {
    origin: 'https://saladofuturo.educacao.sp.gov.br',
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'request-id, traceparent',
  } }, health);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.match(res.headers['access-control-allow-methods'], /GET/);
  const allowedHeaders = res.headers['access-control-allow-headers'].toLowerCase().split(/\s*,\s*/);
  assert.ok(allowedHeaders.includes('request-id'));
  assert.ok(allowedHeaders.includes('traceparent'));
  assert.equal(res.body, null);
});

test('anonymous requests do not require a token and an extraneous authorization header is ignored', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  const anonymous = await invoke();
  const withHeader = await invoke({ authorization: 'Bearer unused-client-value' });
  assert.equal(anonymous.res.statusCode, 200);
  assert.equal(withHeader.res.statusCode, 200);
  assert.equal(calls, 2);
});

test('reports missing Groq configuration without requiring authentication', async () => {
  delete process.env.GROQ_API_KEY;
  const { res } = await invoke();
  assert.equal(res.statusCode, 503);
  assertSanitized(res);
});

test('rejects unsupported methods without invoking the provider', async () => {
  const { res } = await invoke({ method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.match(String(res.headers.allow || res.headers['access-control-allow-methods']), /POST/);
});

const invalidBodies = [
  ['missing context', { ...validInput, context: undefined }],
  ['empty context', { ...validInput, context: '   ' }],
  ['non-string context', { ...validInput, context: { text: 'not a string' } }],
  ['oversized context', { ...validInput, context: 'a'.repeat(18001) }],
  ['oversized theme', { ...validInput, theme: 'a'.repeat(301) }],
  ['non-string theme', { ...validInput, theme: [] }],
  ['oversized instructions', { ...validInput, instructions: 'a'.repeat(2001) }],
  ['unsupported genre', { ...validInput, genre: 'arbitrary' }],
  ['unsupported word count', { ...validInput, words: 999999 }],
  ['unsupported model', { ...validInput, model: 'arbitrary-expensive-model' }],
  ['array body', [validInput]],
  ['malformed JSON', '{"context":'],
];

for (const [label, level] of [
  ['zero writing level', 0],
  ['writing level above five', 6],
  ['negative writing level', -1],
  ['fractional writing level', 2.5],
  ['null writing level', null],
  ['boolean writing level', true],
  ['false writing level', false],
  ['array writing level', [3]],
  ['empty array writing level', []],
  ['object writing level', { level: 3 }],
  ['empty writing level string', ''],
  ['padded writing level string', ' 3 '],
  ['decimal writing level string', '3.0'],
  ['non-numeric writing level', 'Médio'],
]) invalidBodies.push([label, { ...levelInput, level }]);

for (const [label, body] of invalidBodies) {
  test(`rejects ${label} before contacting Groq`, async () => {
    let calls = 0;
    global.fetch = async () => { calls += 1; return responseFor(completion()); };
    const { res } = await invoke({ body });
    assert.equal(res.statusCode, 400);
    assertSanitized(res);
    assert.equal(calls, 0);
  });
}

test('accepts JSON text and the second allowlisted model while keeping provider request bounded', async () => {
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
  const { res } = await invoke({ body: JSON.stringify({ ...validInput, model: 'openai/gpt-oss-120b', words: 250, genre: 'expositiva' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.model, 'openai/gpt-oss-120b');
  assert.match(sent.messages[0].content, /expositiva/i);
  assert.match(sent.messages[0].content, /250/);
});

test('uses the configured allowlisted model when the request does not select one', async () => {
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
  const body = { ...validInput };
  delete body.model;
  const { res } = await invoke({ body });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.model, 'openai/gpt-oss-120b');
});

for (const [upstream, expected] of [[401, 502], [403, 502], [429, 429], [500, 502]]) {
  test(`sanitizes Groq HTTP ${upstream} without exposing provider body or secrets`, async () => {
    const detail = `PRIVATE_PROVIDER_DETAIL ${API_KEY} ${validInput.context}`;
    global.fetch = async () => responseFor({ error: { message: detail } }, upstream, { 'retry-after': '12' });
    const { res } = await invoke();
    assert.equal(res.statusCode, expected);
    assertSanitized(res, ['PRIVATE_PROVIDER_DETAIL', validInput.context]);
    if (upstream === 429) assert.equal(String(res.headers['retry-after']), '12');
  });
}

test('does not echo a non-numeric provider retry-after value', async () => {
  global.fetch = async () => responseFor({ error: { message: 'quota' } }, 429, { 'retry-after': 'PRIVATE_UNTRUSTED_HEADER' });
  const { res } = await invoke();
  assert.equal(res.statusCode, 429);
  assert.notEqual(res.headers['retry-after'], 'PRIVATE_UNTRUSTED_HEADER');
});

for (const [label, upstream] of [
  ['missing choices', {}],
  ['empty output', completion('   ')],
  ['non-string output', completion({ text: 'invalid type' })],
]) {
  test(`rejects ${label} from Groq as a bad upstream response`, async () => {
    global.fetch = async () => responseFor(upstream);
    const { res } = await invoke();
    assert.equal(res.statusCode, 502);
    assertSanitized(res);
  });
}

test('sanitizes malformed provider JSON and network errors', async () => {
  global.fetch = async () => new Response(`MALFORMED_PRIVATE ${API_KEY}`, { status: 200 });
  let result = await invoke();
  assert.equal(result.res.statusCode, 502);
  assertSanitized(result.res, ['MALFORMED_PRIVATE']);
  global.fetch = async () => { throw new Error(`NETWORK_PRIVATE ${API_KEY}`); };
  result = await invoke();
  assert.equal(result.res.statusCode, 502);
  assertSanitized(result.res, ['NETWORK_PRIVATE']);
});

test('preserves provider truncation information together with usable partial text', async () => {
  const partial = 'Uma redação que terminou no limite de saída';
  global.fetch = async () => responseFor(completion(partial, 'length'));
  const { res } = await invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.choices[0].message.content, partial);
  assert.equal(res.body.choices[0].finish_reason, 'length');
});

test('aborts a stalled provider request on its deadline and returns a sanitized timeout', async () => {
  let signal;
  global.setTimeout = (callback, _milliseconds, ...args) => originalTimeout(callback, 0, ...args);
  global.fetch = async (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted private upstream operation.', 'AbortError')), { once: true });
    });
  };
  const { res } = await invoke();
  assert.equal(res.statusCode, 504);
  assert.equal(signal.aborted, true);
  assertSanitized(res, ['private upstream']);
});

test('health reports readiness using booleans without exposing environment values', async () => {
  let result = await invoke({ method: 'GET', authorization: null }, health);
  assert.equal(result.res.statusCode, 200);
  assert.deepEqual(result.res.body, { service: 'redator-groq', configured: true, provider: 'groq', publicAccess: true });
  assert.ok(!JSON.stringify(result.res.body).includes(API_KEY));
  delete process.env.GROQ_API_KEY;
  result = await invoke({ method: 'GET', authorization: null }, health);
  assert.equal(result.res.body.configured, false);
  process.env.GROQ_API_KEY = 'invalid key containing spaces';
  result = await invoke({ method: 'GET', authorization: null }, health);
  assert.equal(result.res.body.configured, false);
});

test('limits valid anonymous generations to five per socket IP per minute and then resets', async () => {
  let now = originalDateNow();
  Date.now = () => now;
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  for (let index = 0; index < 5; index += 1) {
    const { res } = await invoke({ ip: '192.0.2.1' });
    assert.equal(res.statusCode, 200);
  }
  const limited = await invoke({ ip: '192.0.2.1' });
  assert.equal(limited.res.statusCode, 429);
  assert.match(String(limited.res.headers['retry-after']), /^\d+$/);
  assert.ok(Number(limited.res.headers['retry-after']) >= 1);
  assert.match(String(limited.res.headers['access-control-expose-headers']).toLowerCase(), /retry-after/);
  assertSanitized(limited.res);
  assert.equal(calls, 5);
  now += 61000;
  const reset = await invoke({ ip: '192.0.2.1' });
  assert.equal(reset.res.statusCode, 200);
  assert.equal(calls, 6);
});

test('invalid input does not consume the anonymous generation allowance', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  for (let index = 0; index < 7; index += 1) {
    const { res } = await invoke({ body: { ...validInput, context: '' }, ip: '192.0.2.2' });
    assert.equal(res.statusCode, 400);
  }
  for (let index = 0; index < 5; index += 1) {
    const { res } = await invoke({ ip: '192.0.2.2' });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(calls, 5);
});

test('an unconfigured server does not consume quota before its Groq key is provided', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  delete process.env.GROQ_API_KEY;
  for (let index = 0; index < 7; index += 1) {
    const { res } = await invoke({ ip: '192.0.2.3' });
    assert.equal(res.statusCode, 503);
  }
  assert.equal(calls, 0);
  process.env.GROQ_API_KEY = API_KEY;
  for (let index = 0; index < 5; index += 1) {
    const { res } = await invoke({ ip: '192.0.2.3' });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(calls, 5);
});

test('distinct local socket addresses have independent quotas and forwarded IP spoofing is ignored', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  for (let index = 0; index < 5; index += 1) {
    const { res } = await invoke({ ip: '192.0.2.10', headers: { 'x-forwarded-for': `198.51.100.${index + 1}` } });
    assert.equal(res.statusCode, 200);
  }
  const spoofed = await invoke({ ip: '192.0.2.10', headers: { 'x-forwarded-for': '198.51.100.200' } });
  assert.equal(spoofed.res.statusCode, 429);
  const otherSocket = await invoke({ ip: '192.0.2.11', headers: { 'x-forwarded-for': '198.51.100.200' } });
  assert.equal(otherSocket.res.statusCode, 200);
  assert.equal(calls, 6);
});

test('uses the Vercel forwarding IP only when the trusted runtime flag is present', async () => {
  process.env.VERCEL = '1';
  delete require.cache[require.resolve('../api/generate.js')];
  generate = require('../api/generate.js');
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  for (let index = 0; index < 5; index += 1) {
    const { res } = await invoke({ ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.1' } });
    assert.equal(res.statusCode, 200);
  }
  const limited = await invoke({ ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.1' } });
  assert.equal(limited.res.statusCode, 429);
  const distinctClient = await invoke({ ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.2' } });
  assert.equal(distinctClient.res.statusCode, 200);
  assert.equal(calls, 6);
});

test('global minute allowance blocks the thirty-first valid request across distinct IPs', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(completion()); };
  for (let index = 0; index < 30; index += 1) {
    const { res } = await invoke({ ip: `192.0.2.${index + 20}` });
    assert.equal(res.statusCode, 200);
  }
  const limited = await invoke({ ip: '192.0.2.250' });
  assert.equal(limited.res.statusCode, 429);
  assert.match(String(limited.res.headers['retry-after']), /^\d+$/);
  assert.equal(calls, 30);
});
