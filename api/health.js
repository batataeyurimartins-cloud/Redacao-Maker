'use strict';

module.exports = function health(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET para consultar o estado do serviço.' } }));
    return;
  }
  const groq = (process.env.GROQ_API_KEY || '').trim();
  const configured = Boolean(groq && !/\s/.test(groq));
  res.statusCode = 200;
  res.end(JSON.stringify({ service: 'redator-groq', configured, provider: 'groq', publicAccess: true }));
};
