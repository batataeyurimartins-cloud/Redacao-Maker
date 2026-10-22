(() => {
  'use strict';

  // Cole este arquivo inteiro no console. Não há dependências ou instalação.
  const PANEL_ID = 'redator-groq-console';
  const VERSION = '1.3.1';
  const SERVICE_ORIGIN = 'https://redacao-maker.vercel.app';
  const API_URL = `${SERVICE_ORIGIN}/api/generate`;
  const MAX_CONTEXT = 18000;
  const TIMEOUT_MS = 90000;
  let existing = document.getElementById(PANEL_ID);
  if (existing && existing.dataset.redatorVersion !== VERSION) {
    const previousClose = existing.shadowRoot?.getElementById('close');
    if (previousClose) previousClose.click();
    existing.remove();
    existing = document.getElementById(PANEL_ID);
  }
  if (existing) {
    existing.shadowRoot?.getElementById('secondary-close')?.click();
    const body = existing.shadowRoot?.getElementById('panel-body');
    if (body) body.hidden = false;
    const toggle = existing.shadowRoot?.getElementById('minimize');
    if (toggle) {
      toggle.textContent = '−';
      toggle.title = 'Recolher';
      toggle.setAttribute('aria-label','Recolher hub');
      toggle.setAttribute('aria-expanded', 'true');
    }
    existing.shadowRoot?.getElementById('generate')?.focus();
    return;
  }
  if (!document.body || !document.documentElement || !window.AbortController) {
    console.warn('Redator Groq: abra uma página HTML em um navegador atualizado.');
    return;
  }

  let savedSelection = window.getSelection()?.toString().trim() || '';
  let activeRequest = null;
  let closed = false;
  let activePane = null;
  let paneOpener = null;
  let sourceKind = 'Página';
  const host = document.createElement('div');
  host.id = PANEL_ID;
  host.dataset.redatorVersion = VERSION;
  host.style.cssText = 'all:initial!important;position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important;display:block!important;color-scheme:dark!important;';
  const shadow = host.attachShadow({ mode: 'open' });

  // Usa apenas APIs de DOM: nenhum conteúdo da página ou da API vira HTML.
  function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key in node && !key.startsWith('aria')) node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of [children].flat()) {
      if (child != null) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function icon(name) {
    const paths = {
      brand:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h5',
      connection:'M14 7a4 4 0 1 1-2 7l-7 7H2v-3l7-7a4 4 0 0 1 5-4z M16 10h.01',
      source:'M8 3H4v18h16V7h-8V3z M12 3v4h8 M8 12h8 M8 16h6',
      genre:'m4 16-1 5 5-1L20 8l-4-4z M13 7l4 4',
      words:'M4 5h16 M4 10h12 M4 15h16 M4 20h9',
      writing:'M4 7h16 M4 17h16 M9 4v6 M15 14v6',
      result:'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
      arrow:'m9 5 7 7-7 7', close:'m6 6 12 12 M6 18 18 6',
      generate:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    for (const [name,value] of Object.entries({ viewBox:'0 0 24 24', width:'16', height:'16', fill:'none', stroke:'currentColor', 'stroke-width':'1.6', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true' })) svg.setAttribute(name,value);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',paths[name] || paths.arrow);
    svg.append(path);
    return svg;
  }

  const style = element('style', {}, `
    :host { all:initial; color-scheme:dark; }
    *,*::before,*::after { box-sizing:border-box; }
    [hidden] { display:none !important; }
    .card { color:#eeeef1; background:#101012; border:1px solid #ffffff20; border-radius:16px;
      box-shadow:0 16px 60px #0006,0 2px 8px #0004; text-align:left;
      font:12px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .main { width:284px; max-width:calc(100vw - 32px); }
    .hub-header { display:flex; align-items:center; gap:8px; padding:11px 12px; }
    .brand-icon { display:grid; place-items:center; width:26px; height:26px; background:#202024; border:1px solid #ffffff12; border-radius:8px; }
    h2 { margin:0; font-size:13px; font-weight:650; letter-spacing:-.2px; }
    .brand { display:flex; align-items:center; gap:7px; flex:1; }
    .badge { font-size:8px; letter-spacing:1px; color:#a2a2ae; border:1px solid #ffffff20; border-radius:4px; padding:1px 4px; }
    button { border:1px solid #ffffff20; border-radius:8px; background:#1b1b20; color:#ededf1;
      font:inherit; cursor:pointer; padding:8px 11px; line-height:1.4; }
    button:hover:enabled { background:#29292f; }
    button:disabled,input:disabled,textarea:disabled,select:disabled { opacity:.45; cursor:default; }
    button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible {
      outline:2px solid #d7d7e7; outline-offset:3px; }
    .icon-button { width:24px; height:24px; display:grid; place-items:center; padding:0; background:transparent; border-color:transparent; color:#9696a3; }
    .icon-button:hover:enabled { color:white; }
    #minimize { font-size:19px; font-weight:400; }
    #panel-body { padding:0 9px 10px; overflow:auto; overscroll-behavior:contain; max-height:calc(100dvh - 92px); scrollbar-width:thin; }
    .settings { padding:4px 0; border-top:1px solid #ffffff0c; }
    .setting-row { display:flex; align-items:center; gap:8px; width:100%; height:35px; padding:0 7px;
      border:0; border-radius:7px; background:transparent; text-align:left; }
    .setting-row>svg:first-child { color:#858590; flex-shrink:0; width:14px; height:14px; }
    .setting-label { font-size:11px; color:#bebec8; flex-shrink:0; }
    .summary { min-width:0; margin-left:auto; max-width:126px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; color:#f0f0f3; }
    .setting-row>svg:last-child { width:11px; height:11px; color:#62626f; flex-shrink:0; }
    .setting-row[aria-expanded=true] { background:#26262d; }
    .primary { display:flex; align-items:center; justify-content:center; gap:7px; border-color:#ededf1; background:#ededf1; color:#101012; font-weight:650; }
    .primary:hover:enabled { background:#fff; }
    .generate-row { display:flex; gap:6px; margin:5px 2px 0; }
    #generate { flex:1; height:34px; padding:6px 9px; }
    #cancel { padding:6px 8px; }
    #status { margin:9px 5px 0; color:#92929f; font-size:10px; line-height:1.5; max-height:30px; overflow-y:auto; overflow-wrap:anywhere; scrollbar-width:thin; }
    #status[data-kind=error] { color:#f29ca9; }
    #status[data-kind=warning] { color:#ddc38f; }
    .side-status { margin:0 14px 14px; padding-top:10px; border-top:1px solid #ffffff14; color:#ddc38f;
      font-size:11px; line-height:1.5; max-height:85px; overflow:auto; overflow-wrap:anywhere; flex-shrink:0; }
    .side-status[data-kind=error] { color:#f29ca9; }
    .secondary { position:fixed; bottom:16px; left:16px; width:310px; max-width:calc(100vw - 32px);
      max-height:calc(100dvh - 32px); display:flex; flex-direction:column; }
    .side-header { display:flex; align-items:center; gap:8px; padding:13px 14px; border-bottom:1px solid #ffffff10; }
    .side-heading { flex:1; min-width:0; }
    #secondary-title { font-size:13px; }
    #secondary-description { margin:2px 0 0; color:#858592; font-size:10px; }
    .side-content { padding:14px; overflow:auto; overscroll-behavior:contain; min-height:0; scrollbar-width:thin; }
    p { margin:0 0 12px; }
    .muted,small { color:#92929f; font-size:10px; }
    label { display:block; margin:12px 0 5px; color:#c7c7d0; font-size:11px; font-weight:550; }
    .pane>label:first-child { margin-top:0; }
    input,textarea { display:block; width:100%; padding:9px 10px; border:1px solid #ffffff24;
      border-radius:8px; background:#19191e; color:#ededf1; font:inherit; line-height:1.6; }
    input::placeholder,textarea::placeholder { color:#70707d; }
    textarea { min-height:76px; resize:vertical; }
    #context { height:180px; }
    #result { height:260px; }
    .row { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
    .actions { margin:12px 0 0; }
    .full { width:100%; margin-top:14px; }
    .counter { display:block; text-align:right; margin-top:5px; font-variant-numeric:tabular-nums; }
    a { color:#ceced9; text-decoration:underline; text-underline-offset:2px; }
    .choice { display:flex; align-items:center; gap:10px; width:100%; padding:11px; margin-bottom:7px; text-align:left; border-radius:10px; background:#18181d; }
    .choice-copy { flex:1; }
    .choice-label { display:block; font-size:12px; font-weight:550; }
    .choice-description { display:block; color:#8e8e9c; font-size:10px; margin-top:3px; }
    .check { display:grid; place-items:center; width:19px; height:19px; border:1px solid #ffffff28; border-radius:50%; color:transparent; font-size:10px; }
    .choice[aria-pressed=true] { background:#24242c; border-color:#ffffff65; }
    .choice[aria-pressed=true] .check { background:#ededf1; border-color:#ededf1; color:#111; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
    @media (max-width:640px) { .main[data-secondary-open=true] { display:none; } }
    @media (prefers-reduced-motion:no-preference) {
      button { transition:background .14s,border-color .14s; }
      .secondary:not([hidden]) { animation:hub-in .17s ease-out; }
      @keyframes hub-in { from { opacity:0; transform:translateY(7px); } to { opacity:1; transform:translateY(0); } }
    }
  `);

  const modelInput = element('input', { id:'model', value:'openai/gpt-oss-20b', autoComplete:'off', spellcheck:false, maxLength:160 });
  const contextInput = element('textarea', { id:'context', spellcheck:false, maxLength:MAX_CONTEXT, 'aria-describedby':'context-help context-count' });
  const themeInput = element('input', { id:'theme', placeholder:'Opcional: se vazio, inferir a partir do texto', maxLength:300 });
  const genreInput = element('select', { id:'genre', hidden:true, 'aria-label':'Tipo de redação' }, [
    element('option', { value:'dissertativa' }, 'Dissertativa argumentativa'),
    element('option', { value:'enem' }, 'Modelo ENEM'),
    element('option', { value:'expositiva' }, 'Expositiva')
  ]);
  const wordsInput = element('select', { id:'words', hidden:true, 'aria-label':'Extensão aproximada' }, [250,350,500,700].map(n => element('option', { value:String(n), selected:n === 350 }, `${n} palavras`)));
  const instructionsInput = element('textarea', { id:'instructions', maxLength:2000, placeholder:'Opcional: tom, público, argumentos a desenvolver…' });
  const resultInput = element('textarea', { id:'result', readOnly:true, placeholder:'A redação aparecerá aqui.', 'aria-label':'Redação gerada' });
  const status = element('p', { id:'status', role:'status', 'aria-live':'polite', 'aria-atomic':'true' }, 'Preparando leitura da página…');
  const counter = element('small', { id:'context-count', className:'counter' });
  const capturePage = element('button', { id:'capture-page', type:'button' }, 'Ler página');
  const captureSelection = element('button', { id:'capture-selection', type:'button' }, 'Ler seleção');
  const generateText = element('span', {}, 'Gerar redação');
  const generate = element('button', { id:'generate', type:'button', className:'primary' }, [icon('generate'),generateText]);
  const cancel = element('button', { id:'cancel', type:'button', hidden:true }, 'Cancelar');
  const copy = element('button', { id:'copy', type:'button', disabled:true }, 'Copiar');
  const download = element('button', { id:'download', type:'button', disabled:true }, 'Baixar .txt');
  const close = element('button', { id:'close', type:'button', className:'icon-button', 'aria-label':'Fechar hub', title:'Fechar' }, icon('close'));
  const minimize = element('button', { id:'minimize', type:'button', className:'icon-button', 'aria-label':'Recolher hub', title:'Recolher', 'aria-expanded':'true', 'aria-controls':'panel-body' }, '−');
  const summaries = {};
  const triggers = {};
  const paneInfo = {
    connection:['Modelo da Groq','Uso público, sem login ou código de acesso.'],
    source:['Texto de referência','Escolha a origem e confira o conteúdo.'],
    genre:['Tipo de redação','Escolheu, pronto. A opção volta para o hub.'],
    words:['Extensão aproximada','Qual o tamanho da sua redação?'],
    writing:['Tema e instruções','Dê uma direção à sua redação.'],
    result:['Sua redação','Revise antes de copiar ou baixar.']
  };
  function setting(name,label) {
    summaries[name] = element('span', { id:`summary-${name}`, className:'summary' });
    triggers[name] = element('button', { id:`open-${name}`, type:'button', className:'setting-row', 'aria-controls':'secondary-panel', 'aria-expanded':'false' }, [icon(name),element('span',{ className:'setting-label' },label),summaries[name],icon('arrow')]);
    return triggers[name];
  }
  const body = element('div', { id:'panel-body' }, [
    element('div', { className:'settings' }, [setting('connection','Modelo'),setting('source','Referência'),setting('genre','Tipo'),setting('words','Extensão'),setting('writing','Tema'),setting('result','Redação')]),
    element('div', { className:'generate-row' }, [generate,cancel]),status
  ]);
  const main = element('section', { id:'main-panel', className:'card main', role:'region', 'aria-label':'Redator Groq', 'data-secondary-open':'false' }, [
    element('header', { className:'hub-header' }, [element('span',{ className:'brand-icon' },icon('brand')),element('div',{ className:'brand' },[element('h2',{},'Redator'),element('span',{ className:'badge' },'GROQ')]),minimize,close]),body
  ]);
  const saveConnection = element('button', { id:'save-connection', type:'button', className:'primary full' }, 'Usar este modelo');
  const saveSource = element('button', { id:'save-source', type:'button', className:'primary full' }, 'Usar este texto');
  const saveWriting = element('button', { id:'save-writing', type:'button', className:'primary full' }, 'Usar estas instruções');
  const genreOptions = [
    ['dissertativa','Argumentativa','Defenda uma ideia com argumentos e conclusão.'],
    ['enem','Modelo ENEM','Tese, dois argumentos e proposta de intervenção.'],
    ['expositiva','Expositiva','Explique o assunto com clareza e organização.']
  ];
  const wordOptions = [[250,'Breve'],[350,'Equilibrada'],[500,'Detalhada'],[700,'Longa']];
  function choice(kind,value,label,description) {
    return element('button',{ id:`choice-${kind}-${value}`, type:'button', className:'choice', 'data-choice':kind, 'data-value':String(value), 'aria-pressed':'false' },[
      element('span',{ className:'choice-copy' },[element('span',{ className:'choice-label' },label),element('span',{ className:'choice-description' },description)]),element('span',{ className:'check', 'aria-hidden':'true' },'✓')
    ]);
  }
  const panes = {
    connection:element('div',{ id:'pane-connection', className:'pane', hidden:true },[
      element('label',{ htmlFor:'model' },'Modelo'),modelInput,
      element('small',{},'Modelos: openai/gpt-oss-20b ou openai/gpt-oss-120b. A API é pública; a chave da Groq fica no servidor.'),saveConnection
    ]),
    source:element('div',{ id:'pane-source', className:'pane', hidden:true },[
      element('div',{ className:'row' },[capturePage,captureSelection]),
      element('label',{ htmlFor:'context' },'Texto de referência'),contextInput,counter,
      element('p',{ id:'context-help', className:'muted' },'Confira o conteúdo antes de gerar. Este texto será enviado à Groq.'),saveSource
    ]),
    genre:element('div',{ id:'pane-genre', className:'pane', hidden:true },[genreInput,...genreOptions.map(([value,label,desc]) => choice('genre',value,label,desc))]),
    words:element('div',{ id:'pane-words', className:'pane', hidden:true },[wordsInput,...wordOptions.map(([value,desc]) => choice('words',value,`${value} palavras`,desc))]),
    writing:element('div',{ id:'pane-writing', className:'pane', hidden:true },[
      element('label',{ htmlFor:'theme' },'Tema'),themeInput,
      element('label',{ htmlFor:'instructions' },'Instruções adicionais'),instructionsInput,
      element('small',{},'Sem tema? O assunto será identificado pelo texto de referência.'),saveWriting
    ]),
    result:element('div',{ id:'pane-result', className:'pane', hidden:true },[
      element('label',{ htmlFor:'result' },'Redação gerada'),resultInput,
      element('small',{ id:'result-count', className:'counter' },'0 palavras'),
      element('div',{ className:'row actions' },[copy,download])
    ])
  };
  const secondaryTitle = element('h2',{ id:'secondary-title' });
  const secondaryDescription = element('p',{ id:'secondary-description' });
  const secondaryClose = element('button',{ id:'secondary-close', type:'button', className:'icon-button', 'aria-label':'Fechar opções', title:'Voltar ao hub' },icon('close'));
  const secondaryStatus = element('p',{ id:'secondary-status', className:'side-status', hidden:true });
  const secondary = element('section',{ id:'secondary-panel', className:'card secondary', role:'region', 'aria-labelledby':'secondary-title', hidden:true },[
    element('header',{ className:'side-header' },[element('div',{ className:'side-heading' },[secondaryTitle,secondaryDescription]),secondaryClose]),
    element('div',{ className:'side-content' },Object.values(panes)),secondaryStatus
  ]);
  const announcement = element('span',{ className:'sr-only', role:'status', 'aria-live':'polite', 'aria-atomic':'true' });
  shadow.append(style,main,secondary,announcement);
  document.documentElement.append(host);

  function syncSummaries() {
    summaries.connection.textContent = ({ 'openai/gpt-oss-20b':'GPT-OSS · 20B', 'openai/gpt-oss-120b':'GPT-OSS · 120B' })[modelInput.value.trim()] || modelInput.value.trim() || 'Selecionar';
    summaries.source.textContent = contextInput.value.trim() ? `${sourceKind} · ${contextInput.value.length.toLocaleString('pt-BR')} car.` : 'Adicionar texto';
    summaries.genre.textContent = genreOptions.find(([value]) => value === genreInput.value)?.[1] || 'Argumentativa';
    summaries.words.textContent = `${wordsInput.value} palavras`;
    summaries.writing.textContent = themeInput.value.trim() || (instructionsInput.value.trim() ? 'Personalizado' : 'Automático');
    const count = resultInput.value.match(/\S+/gu)?.length || 0;
    summaries.result.textContent = count ? `${count.toLocaleString('pt-BR')} palavras` : 'Aguardando';
    for (const summary of Object.values(summaries)) summary.title = summary.textContent;
    for (const button of shadow.querySelectorAll('[data-choice]')) {
      const selected = (button.dataset.choice === 'genre' ? genreInput : wordsInput).value === button.dataset.value;
      button.setAttribute('aria-pressed',String(selected));
    }
  }

  function closePane(restoreFocus = true) {
    if (!activePane) return;
    const opener = paneOpener;
    activePane = null;
    paneOpener = null;
    secondary.hidden = true;
    main.dataset.secondaryOpen = 'false';
    for (const trigger of Object.values(triggers)) trigger.setAttribute('aria-expanded','false');
    if (restoreFocus && !closed) opener?.focus({ preventScroll:true });
  }

  function openPane(name, focus = true) {
    if (closed || !panes[name]) return;
    activePane = name;
    paneOpener = triggers[name];
    for (const [key,pane] of Object.entries(panes)) pane.hidden = key !== name;
    for (const [key,trigger] of Object.entries(triggers)) trigger.setAttribute('aria-expanded',String(key === name));
    secondaryTitle.textContent = paneInfo[name][0];
    secondaryDescription.textContent = paneInfo[name][1];
    secondary.hidden = false;
    main.dataset.secondaryOpen = 'true';
    if (focus) {
      const first = panes[name].querySelector('input:not(:disabled),textarea:not(:disabled),button[aria-pressed=true]:not(:disabled),button:not(:disabled)');
      (first || secondaryClose).focus({ preventScroll:true });
    }
  }

  function setStatus(message, kind = 'info') {
    status.textContent = message;
    status.title = message;
    status.dataset.kind = kind;
    secondaryStatus.textContent = message;
    secondaryStatus.dataset.kind = kind;
    secondaryStatus.hidden = kind !== 'error' && kind !== 'warning';
  }

  function updateCounter() {
    counter.textContent = `${contextInput.value.length.toLocaleString('pt-BR')} / 18.000 caracteres`;
    syncSummaries();
  }

  function setBusy(busy) {
    for (const control of [modelInput,contextInput,themeInput,genreInput,wordsInput,instructionsInput,capturePage,captureSelection,generate,saveConnection,saveSource,saveWriting,...shadow.querySelectorAll('[data-choice]')]) {
      control.disabled = busy;
    }
    cancel.hidden = !busy;
    generateText.textContent = busy ? 'Gerando…' : 'Gerar redação';
    body.setAttribute('aria-busy', String(busy));
  }

  const excluded = [
    'script','style','noscript','template','nav','header','footer','aside','form','input',
    'textarea','select','button','iframe','canvas','svg','dialog','[hidden]','[inert]',
    '[aria-hidden="true" i]','[role="navigation"]','[role="banner"]','[role="search"]',
    '[role="textbox"]','[contenteditable]:not([contenteditable="false" i])'
  ].join(',');

  function readPage() {
    const visibility = new WeakMap();
    function visible(node) {
      if (!node || node === document.documentElement) return true;
      if (visibility.has(node)) return visibility.get(node);
      const parent = node.parentElement;
      const hiddenByDetails = parent?.localName === 'details' && !parent.open &&
        node !== [...parent.children].find(child => child.localName === 'summary');
      const css = window.getComputedStyle(node);
      const ok = node !== host && !hiddenByDetails && !node.matches(excluded) && css.display !== 'none' &&
        css.visibility !== 'hidden' && css.visibility !== 'collapse' && css.contentVisibility !== 'hidden' &&
        css.opacity !== '0' && visible(parent);
      visibility.set(node,ok);
      return ok;
    }
    function extract(candidates) {
      // Não duplica artigos aninhados e não percorre raízes ocultas.
      const visibleRoots = candidates.filter(visible);
      const roots = visibleRoots.filter(node => !visibleRoots.some(other => other !== node && other.contains(node)));
      let text = '';
      let previousBlock = null;
      let visited = 0;
      let truncated = false;
      outer: for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) return visible(node) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
            if (node.parentElement?.localName === 'details' && !node.parentElement.open) return NodeFilter.FILTER_REJECT;
            return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });
        let node;
        while ((node = walker.nextNode())) {
          visited++;
          const fragment = node.textContent.replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();
          if (!fragment) continue;
          const block = node.parentElement.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,div,section,article,main');
          const separator = text ? (block !== previousBlock ? '\n\n' : ' ') : '';
          const remaining = MAX_CONTEXT - text.length;
          if (separator.length + fragment.length > remaining) {
            text += (separator + fragment).slice(0,remaining);
            truncated = true;
            break outer;
          }
          text += separator + fragment;
          previousBlock = block;
          if (visited >= 50000) { truncated = true; break outer; }
        }
      }
      return { text:text.trim(), truncated };
    }
    // Uma área principal vazia também permite tentar os artigos e o corpo.
    let content = extract([...document.querySelectorAll('main,[role="main"]')]);
    if (!content.text) content = extract([...document.querySelectorAll('article')]);
    if (!content.text) content = extract([document.body]);
    return content;
  }

  function applyContext(text, label, truncated = false) {
    const limited = text.length > MAX_CONTEXT || truncated;
    contextInput.value = text.slice(0,MAX_CONTEXT).trim();
    updateCounter();
    const captureNotice = limited ? ' O conteúdo foi limitado a 18.000 caracteres; ajuste o trecho se necessário.' : '';
    if (!contextInput.value) {
      setStatus('Não encontrei texto legível. Selecione um trecho e clique em Ler seleção, ou cole o texto no campo de referência.','warning');
    } else {
      setStatus(`${label} Revise o texto antes de gerar.${captureNotice}`, limited ? 'warning' : 'info');
    }
  }

  function capturePageText() {
    try {
      const content = readPage();
      sourceKind = 'Página';
      applyContext(content.text,'Página lida.',content.truncated);
      return Boolean(content.text);
    } catch {
      setStatus('Não foi possível ler esta página. Cole o texto manualmente no campo de referência.','error');
      return false;
    }
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim()) return;
    for (const node of [selection.anchorNode,selection.focusNode]) {
      if (!node || node.getRootNode() === shadow || host.contains(node)) return;
    }
    savedSelection = selection.toString().trim();
  }

  function createRequest() {
    return {
      context:contextInput.value.trim(),theme:themeInput.value.trim(),
      genre:genreInput.value,words:Number(wordsInput.value),
      instructions:instructionsInput.value.trim(),model:modelInput.value.trim()
    };
  }

  function httpError(response, payload) {
    const messages = {
      400:'A API recusou os parâmetros. Confira o modelo e o texto de referência.',
      401:'O servidor recusou a solicitação. Recarregue o script ou tente novamente mais tarde.',
      402:'Sua conta Groq precisa de saldo ou de uma alteração no plano.',
      403:'A API negou o acesso à solicitação. Tente novamente mais tarde.',
      404:'Modelo ou recurso não encontrado. Confira o identificador do modelo.',
      413:'O texto excedeu o limite aceito pela Groq. Reduza o texto de referência.',
      429:'Limite de uso atingido. Aguarde antes de tentar novamente.',
      503:'O administrador ainda precisa configurar GROQ_API_KEY na Vercel.',
      504:'A Groq demorou para responder. Tente novamente em instantes.'
    };
    let message = messages[response.status] || (response.status >= 500 ? 'A Groq está indisponível no momento. Tente novamente em instantes.' : 'Não foi possível concluir a solicitação à Groq.');
    const retry = response.headers.get('retry-after');
    if (response.status === 429 && retry && /^\d+(\.\d+)?$/.test(retry)) message += ` Aguarde cerca de ${Math.ceil(Number(retry))} segundos.`;
    if ([400,404,502,503].includes(response.status) && typeof payload?.error?.message === 'string') {
      const detail = payload.error.message.slice(0,350);
      message += ` Detalhe: ${detail}`;
    }
    return new Error(`${message} (HTTP ${response.status})`);
  }

  async function generateEssay() {
    if (activeRequest || closed) return;
    if (!contextInput.value.trim()) {
      setStatus('Leia a página, selecione um trecho ou cole um texto de referência antes de gerar.','error');
      openPane('source');
      contextInput.focus();
      return;
    }
    if (contextInput.value.length > MAX_CONTEXT) {
      setStatus('Reduza o texto de referência para até 18.000 caracteres.','error');
      openPane('source');
      return;
    }
    if (!modelInput.value.trim()) {
      setStatus('Informe o identificador de um modelo da Groq.','error');
      openPane('connection');
      modelInput.focus();
      return;
    }
    closePane(false);
    const request = { controller:new AbortController(), reason:null, timer:null };
    activeRequest = request;
    request.timer = window.setTimeout(() => {
      request.reason = 'timeout';
      request.controller.abort();
    },TIMEOUT_MS);
    setBusy(true);
    setStatus('Gerando a redação com a Groq… Você pode cancelar a solicitação.');
    try {
      const response = await fetch(API_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        credentials:'omit',
        referrerPolicy:'no-referrer',
        signal:request.controller.signal,
        body:JSON.stringify(createRequest())
      });
      let payload;
      try { payload = await response.json(); }
      catch {
        if (request.controller.signal.aborted) throw new Error('aborted');
        if (!response.ok) throw httpError(response,null);
        throw new Error('A Groq devolveu uma resposta inválida. Tente novamente.');
      }
      if (!response.ok) throw httpError(response,payload);
      if (request.controller.signal.aborted || closed) return;
      const choice = payload?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('A Groq devolveu uma resposta vazia ou em formato inválido. Tente novamente ou escolha outro modelo.');
      }
      resultInput.value = content.trim();
      const count = resultInput.value.match(/\S+/gu)?.length || 0;
      shadow.getElementById('result-count').textContent = `${count.toLocaleString('pt-BR')} palavras`;
      copy.disabled = false;
      download.disabled = false;
      syncSummaries();
      if (choice.finish_reason === 'length') {
        setStatus('O limite de saída foi atingido e a redação pode estar incompleta. O trecho recebido está abaixo; tente uma extensão menor.','warning');
      } else if (choice.finish_reason && choice.finish_reason !== 'stop') {
        setStatus('A resposta terminou antes da conclusão normal. Revise o texto recebido e tente novamente se necessário.','warning');
      } else {
        setStatus('Redação pronta. Revise o texto antes de copiar ou baixar.');
      }
      if (!body.hidden) openPane('result');
    } catch (error) {
      if (closed) return;
      if (request.controller.signal.aborted) {
        setStatus(request.reason === 'timeout' ? 'A Groq demorou mais de 90 segundos. A solicitação foi interrompida; tente novamente.' : 'Geração cancelada. Você pode tentar novamente.','warning');
      } else if (error instanceof TypeError) {
        setStatus('Falha de conexão com a API. Verifique sua internet. A política de segurança da página (CSP/CORS) também pode bloquear o servidor; tente outra página confiável.','error');
      } else {
        setStatus(error?.message || 'Ocorreu um erro inesperado ao gerar a redação.','error');
      }
    } finally {
      clearTimeout(request.timer);
      if (activeRequest === request) activeRequest = null;
      if (!closed) setBusy(false);
    }
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    if (activeRequest) {
      clearTimeout(activeRequest.timer);
      activeRequest.controller.abort();
    }
    contextInput.value = '';
    resultInput.value = '';
    savedSelection = '';
    document.removeEventListener('selectionchange',rememberSelection);
    document.removeEventListener('pointerdown',outsideClick);
    document.removeEventListener('keydown',outsideKeydown);
    window.removeEventListener('pagehide',cleanup);
    host.remove();
  }

  for (const [name,trigger] of Object.entries(triggers)) trigger.addEventListener('click',() => {
    if (activePane === name) closePane();
    else openPane(name);
  });
  secondaryClose.addEventListener('click',() => closePane());
  for (const button of shadow.querySelectorAll('[data-choice]')) button.addEventListener('click',() => {
    const kind = button.dataset.choice;
    const input = kind === 'genre' ? genreInput : wordsInput;
    input.value = button.dataset.value;
    syncSummaries();
    announcement.textContent = `${kind === 'genre' ? 'Tipo' : 'Extensão'}: ${summaries[kind].textContent}.`;
    closePane();
  });
  saveConnection.addEventListener('click',() => {
    if (!modelInput.value.trim()) {
      modelInput.setCustomValidity('Informe o identificador do modelo.');
      modelInput.reportValidity();
      return;
    }
    syncSummaries();
    announcement.textContent = 'Configuração da Groq atualizada.';
    setStatus('Configuração da Groq atualizada.');
    closePane();
  });
  saveSource.addEventListener('click',() => {
    syncSummaries();
    announcement.textContent = 'Texto de referência selecionado.';
    setStatus('Texto de referência atualizado.');
    closePane();
  });
  saveWriting.addEventListener('click',() => {
    syncSummaries();
    announcement.textContent = 'Tema e instruções atualizados.';
    setStatus('Tema e instruções atualizados.');
    closePane();
  });
  capturePage.addEventListener('click',() => {
    if (capturePageText()) closePane();
  });
  captureSelection.addEventListener('click',() => {
    rememberSelection();
    if (savedSelection) {
      sourceKind = 'Seleção';
      applyContext(savedSelection,'Trecho selecionado capturado.');
      closePane();
    }
    else setStatus('Selecione um texto fora do painel e clique em Ler seleção. Você também pode colar o texto manualmente.','warning');
  });
  contextInput.addEventListener('input',() => { sourceKind = 'Manual'; updateCounter(); });
  for (const input of [modelInput,themeInput,instructionsInput]) input.addEventListener('input',() => {
    input.setCustomValidity('');
    syncSummaries();
  });
  generate.addEventListener('click',generateEssay);
  cancel.addEventListener('click',() => {
    if (!activeRequest) return;
    activeRequest.reason = 'user';
    activeRequest.controller.abort();
  });
  minimize.addEventListener('click',() => {
    closePane(false);
    body.hidden = !body.hidden;
    minimize.textContent = body.hidden ? '+' : '−';
    minimize.title = body.hidden ? 'Expandir' : 'Recolher';
    minimize.setAttribute('aria-label',body.hidden ? 'Expandir hub' : 'Recolher hub');
    minimize.setAttribute('aria-expanded', String(!body.hidden));
  });
  close.addEventListener('click',cleanup);
  document.addEventListener('selectionchange',rememberSelection);
  function outsideClick(event) {
    if (activePane && !event.composedPath().includes(host)) closePane(false);
  }
  function outsideKeydown(event) {
    if (activePane && event.key === 'Escape') closePane();
  }
  document.addEventListener('pointerdown',outsideClick);
  document.addEventListener('keydown',outsideKeydown);
  window.addEventListener('pagehide',cleanup);
  host.addEventListener('keydown',event => {
    // Evita que atalhos comuns da página reajam à digitação no painel.
    event.stopPropagation();
    if (event.key === 'Escape' && activePane) {
      event.preventDefault();
      closePane();
    }
  });
  copy.addEventListener('click',async () => {
    const text = resultInput.value;
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (!closed) setStatus('Redação copiada.');
    } catch {
      if (closed) return;
      resultInput.focus();
      resultInput.select();
      setStatus('O navegador bloqueou a cópia automática. O texto está selecionado: use Ctrl+C ou ⌘C.','warning');
    }
  });
  download.addEventListener('click',() => {
    if (!resultInput.value) return;
    const url = URL.createObjectURL(new Blob([resultInput.value],{ type:'text/plain;charset=utf-8' }));
    const anchor = element('a',{ href:url, download:'redacao-groq.txt' });
    shadow.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  });

  syncSummaries();
  if (savedSelection) {
    sourceKind = 'Seleção';
    applyContext(savedSelection,'Trecho selecionado capturado.');
  }
  else capturePageText();
})();
