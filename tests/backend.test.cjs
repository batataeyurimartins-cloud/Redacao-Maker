'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test, before, beforeEach, afterEach } = require('node:test');

const ACCESS_TOKEN = 'test_hub_access_token_not_a_real_secret_2026';
const API_KEY = 'gsk_FAKE_SERVER_SECRET_FOR_TESTS_ONLY';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const validInput = {
  context: 'A inclusão digital amplia o acesso à educação, mas o custo da conexão cria barreiras.',
  theme: 'Inclusão digital e cidadania',
  genre: 'enem',
  words: 500,
  instructions: 'Discuta o papel das bibliotecas públicas.',
  model: DEFAULT_MODEL,
};

let generate;
let health;
let originalFetch;
let originalTimeout;
let previousEnv;

before(() => {
  generate = require('../api/generate.js');
  health = require('../api/health.js');
});

beforeEach(() => {
  previousEnv = Object.fromEntries(['GROQ_API_KEY', 'HUB_ACCESS_TOKEN', 'GROQ_MODEL'].map(key => [key, process.env[key]]));
  originalFetch = global.fetch;
  originalTimeout = global.setTimeout;
  process.env.GROQ_API_KEY = API_KEY;
  process.env.HUB_ACCESS_TOKEN = ACCESS_TOKEN;
  delete process.env.GROQ_MODEL;
  global.fetch = async () => { throw new Error('Unexpected provider request in backend test.'); };
});

afterEach(() => {
  global.fetch = originalFetch;
  global.setTimeout = originalTimeout;
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

function createRequest({ method = 'POST', body = { ...validInput }, authorization = `Bearer ${ACCESS_TOKEN}`, headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = method === 'GET' ? '/api/health' : '/api/generate';
  req.headers = { 'content-type': 'application/json', ...headers };
  if (authorization !== null) req.headers.authorization = authorization;
  req.body = body;
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
  for (const secret of [API_KEY, ACCESS_TOKEN, ...forbidden]) {
    assert.ok(!output.includes(secret), `response leaked ${secret.slice(0, 8)}…`);
  }
  assert.equal(typeof res.body?.error?.message, 'string');
  assert.ok(res.body.error.message.length > 0);
}

test('backend authenticates and builds its own Groq prompt from normalized essay settings', async () => {
  let sent;
  global.fetch = async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return responseFor(completion('  Redação recebida com segurança.  '));
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
  assert.equal(sent.body.messages[0].role, 'system');
  assert.equal(sent.body.messages[1].role, 'user');
  const prompt = JSON.stringify(sent.body.messages);
  assert.match(prompt, /ENEM/);
  assert.match(prompt, /500/);
  assert.match(prompt, /bibliotecas públicas/);
  assert.match(prompt, /Inclusão digital e cidadania/);
  assert.match(prompt, /não confiável|comandos|instruções/i);
  assert.doesNotMatch(prompt, /CLIENT_SYSTEM_OVERRIDE_MARKER/);
  assert.ok(!JSON.stringify(sent.body).includes(API_KEY));
  assert.ok(!JSON.stringify(sent.body).includes(ACCESS_TOKEN));
  assert.equal(res.body.choices[0].message.content.trim(), 'Redação recebida com segurança.');
  assert.equal(res.body.choices[0].finish_reason, 'stop');
  assert.equal(res.body.model, DEFAULT_MODEL);
  assert.ok(!JSON.stringify(res.body).includes(API_KEY));
  assert.ok(!JSON.stringify(res.body).includes(ACCESS_TOKEN));
});

test('CORS preflight is public but never invokes the provider or exposes credentials', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('not expected'); };
  delete process.env.GROQ_API_KEY;
  delete process.env.HUB_ACCESS_TOKEN;
  const { res } = await invoke({ method: 'OPTIONS', authorization: null });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.match(String(res.headers['access-control-allow-methods']), /POST/);
  assert.match(String(res.headers['access-control-allow-methods']), /OPTIONS/);
  assert.match(String(res.headers['access-control-allow-headers']).toLowerCase(), /authorization/);
  assert.match(String(res.headers['access-control-allow-headers']).toLowerCase(), /content-type/);
  assert.match(String(res.headers['access-control-expose-headers']).toLowerCase(), /retry-after/);
  assert.equal(calls, 0);
});

for (const [label, authorization] of [
  ['missing', null],
  ['wrong', 'Bearer invalid_token'],
  ['malformed', ACCESS_TOKEN],
]) {
  test(`rejects ${label} access token before reading body or checking the Groq configuration`, async () => {
    delete process.env.GROQ_API_KEY;
    let calls = 0;
    global.fetch = async () => { calls += 1; throw new Error('not expected'); };
    const req = createRequest({ authorization });
    Object.defineProperty(req, 'body', { get() { throw new Error('Body must not be inspected before authentication.'); } });
    const res = createResponse();
    await generate(req, res);
    assert.equal(res.statusCode, 401);
    assertSanitized(res);
    assert.equal(calls, 0);
  });
}

test('does not become an open relay when the server access token is missing or too short', async () => {
  for (const token of ['', 'short']) {
    process.env.HUB_ACCESS_TOKEN = token;
    const { res } = await invoke();
    assert.equal(res.statusCode, 503);
    assertSanitized(res);
  }
});

test('reports missing Groq configuration only to an authenticated caller', async () => {
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
  const { res } = await invoke({ body: JSON.stringify({ ...validInput, model: 'llama-3.1-8b-instant', words: 250, genre: 'expositiva' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.model, 'llama-3.1-8b-instant');
  assert.match(sent.messages[0].content, /expositiva/i);
  assert.match(sent.messages[0].content, /250/);
});

test('uses the configured allowlisted model when the request does not select one', async () => {
  process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
  let sent;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return responseFor(completion()); };
  const body = { ...validInput };
  delete body.model;
  const { res } = await invoke({ body });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.model, 'llama-3.1-8b-instant');
});

for (const [upstream, expected] of [[401, 502], [403, 502], [429, 429], [500, 502]]) {
  test(`sanitizes Groq HTTP ${upstream} without exposing provider body or secrets`, async () => {
    const detail = `PRIVATE_PROVIDER_DETAIL ${API_KEY} ${ACCESS_TOKEN} ${validInput.context}`;
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
  assert.deepEqual(result.res.body, { service: 'redator-groq', configured: true, provider: 'groq' });
  assert.ok(!JSON.stringify(result.res.body).includes(API_KEY));
  assert.ok(!JSON.stringify(result.res.body).includes(ACCESS_TOKEN));
  delete process.env.GROQ_API_KEY;
  result = await invoke({ method: 'GET', authorization: null }, health);
  assert.equal(result.res.body.configured, false);
  process.env.GROQ_API_KEY = API_KEY;
  process.env.HUB_ACCESS_TOKEN = 'short';
  result = await invoke({ method: 'GET', authorization: null }, health);
  assert.equal(result.res.body.configured, false);
});
