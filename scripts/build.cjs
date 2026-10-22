'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const publicDirectory = path.join(projectRoot, 'public');
const sourcePath = path.join(projectRoot, 'redator-groq.js');
const publicScriptNames = ['redator-groq.js', 'hub.js'];

// Only public deployment coordinates are read here. Credentials stay on the server.
const configuredOrigin = process.env.DEPLOYMENT_ORIGIN || process.env.VERCEL_PROJECT_PRODUCTION_URL;
let source = fs.readFileSync(sourcePath, 'utf8');

if (configuredOrigin) {
  const originText = configuredOrigin.trim();
  const url = new URL(originText.includes('://') ? originText : `https://${originText}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The public deployment URL must be an HTTPS origin without credentials, path, query or fragment.');
  }
  const declaration = /const SERVICE_ORIGIN\s*=\s*(['"])[^'"\r\n]*\1\s*;/;
  if (!declaration.test(source)) {
    throw new Error('redator-groq.js must declare const SERVICE_ORIGIN before a deployment origin can be configured.');
  }
  source = source.replace(declaration, `const SERVICE_ORIGIN = ${JSON.stringify(url.origin)};`);
}

fs.mkdirSync(publicDirectory, { recursive:true });
for (const fileName of publicScriptNames) {
  fs.writeFileSync(path.join(publicDirectory, fileName), source, 'utf8');
}
console.log('Public console scripts prepared: public/redator-groq.js and public/hub.js');
