'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const publicDirectory = path.join(projectRoot, 'public');
const sourcePath = path.join(projectRoot, 'redator-groq.js');
const publicScriptNames = ['redator-groq.js', 'hub.js'];
const fallbackOrigin = 'https://redacao-maker.vercel.app';
const serviceOriginDeclaration = /const SERVICE_ORIGIN\s*=\s*(['"])([^'"\r\n]*)\1\s*;/;

function verifiedOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The public deployment URL must be an HTTPS origin without credentials, path, query or fragment.');
  }
  return url.origin;
}

function escapeHtmlAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Only public deployment coordinates are read here. Credentials stay on the server.
const configuredOrigin = process.env.DEPLOYMENT_ORIGIN || process.env.VERCEL_PROJECT_PRODUCTION_URL;
let source = fs.readFileSync(sourcePath, 'utf8');

if (configuredOrigin) {
  const originText = configuredOrigin.trim();
  const origin = verifiedOrigin(originText.includes('://') ? originText : `https://${originText}`);
  if (!serviceOriginDeclaration.test(source)) {
    throw new Error('redator-groq.js must declare const SERVICE_ORIGIN before a deployment origin can be configured.');
  }
  source = source.replace(serviceOriginDeclaration, `const SERVICE_ORIGIN = ${JSON.stringify(origin)};`);
}

const serviceOrigin = verifiedOrigin(source.match(serviceOriginDeclaration)?.[2] || fallbackOrigin);
const publicScriptUrl = new URL('/hub.js', serviceOrigin).href;
const bookmarkletBody = `(()=>{const s=document.createElement('script');s.src=${JSON.stringify(publicScriptUrl)};s.onload=()=>s.remove();s.onerror=()=>{s.remove();alert('Nao foi possivel abrir o hub nesta pagina. Acesse https://redacao-maker.vercel.app para ver as alternativas.')};document.documentElement.appendChild(s)})()`;
const bookmarklet = `javascript:${encodeURIComponent(bookmarkletBody)}`;
const bookmarkImportHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Redator Groq</TITLE>
<H1>Redator Groq</H1>
<DL><p>
    <DT><A HREF="${escapeHtmlAttribute(bookmarklet)}">Redator Groq</A>
</DL><p>
`;

fs.mkdirSync(publicDirectory, { recursive:true });
for (const fileName of publicScriptNames) {
  fs.writeFileSync(path.join(publicDirectory, fileName), source, 'utf8');
}
fs.writeFileSync(path.join(publicDirectory, 'bookmarklet.txt'), `${bookmarklet}\n`, 'utf8');
fs.writeFileSync(path.join(publicDirectory, 'favorito-redator-groq.html'), bookmarkImportHtml, 'utf8');
console.log('Public console scripts and bookmarklet installation files prepared.');
