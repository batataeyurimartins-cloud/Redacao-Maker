(() => {
  'use strict';

  // Cole este arquivo inteiro no console. Não há dependências ou instalação.
  const PANEL_ID = 'redator-batata-console';
  const VERSION = '1.10.1';
  const SERVICE_ORIGIN = 'https://redacao-maker.vercel.app';
  const API_URL = `${SERVICE_ORIGIN}/api/generate`;
  const MAX_CONTEXT = 18000;
  const TIMEOUT_MS = 90000;
  const BLOCKED_CONNECTION_MESSAGE = 'Esta página bloqueia conexões externas por CSP. Clique em Gerar em janela auxiliar para tentar pela conexão do serviço.';
  const previousBrand = document.getElementById('redator-groq-console');
  if (previousBrand) {
    previousBrand.shadowRoot?.getElementById('close')?.click();
    previousBrand.remove();
  }
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
    existing.dispatchEvent(new Event('redator-reopen'));
    return;
  }
  if (!document.body || !document.documentElement || !window.AbortController) {
    console.warn('Redator Batata: abra uma página HTML em um navegador atualizado.');
    return;
  }

  let savedSelection = window.getSelection()?.toString().trim() || '';
  let activeRequest = null;
  let closed = false;
  let activePane = null;
  let paneOpener = null;
  let sourceKind = 'Página';
  let useConnectionWindow = false;
  let connectionBlockedByPolicy = false;
  let generatedNotice = null;
  let filledNotice = null;
  let pendingFill = null;
  let searchNotice = null;
  let fillTail = Promise.resolve();
  let fillRevision = 0;
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
    #panel-body { padding:0 9px 10px; overflow:auto; overscroll-behavior:contain; max-height:calc(75dvh - 92px); scrollbar-width:thin; }
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
    #connection-help { display:block; margin:8px 4px 0; font-size:10px; }
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
    #field-inspector { margin-top:12px; padding-top:12px; border-top:1px solid #ffffff18; }
    #field-inspector-summary { font-size:10px; color:#b6b6c2; overflow-wrap:anywhere; }
    .field-option { margin:8px 0; padding:9px; border:1px solid #ffffff20; border-radius:8px; background:#19191e; }
    .field-option strong,.field-option small { display:block; overflow-wrap:anywhere; }
    .field-option .row { margin-top:7px; }
    .field-option button { padding:6px 8px; font-size:10px; }
    .field-option button[aria-pressed=true] { border-color:#d4d4df; background:#34343f; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
    @media (max-width:640px) {
      .main[data-secondary-open=true] { display:none; }
      .secondary { max-height:calc(75dvh - 32px); }
    }
    .primary { position:relative; overflow:hidden; }
    .choice .choice-label { font-size:12px; }
    .choice { margin-bottom:8px; }
    @media (prefers-reduced-motion:no-preference) {
      button,a,input,textarea,.setting-row,.summary,.check { transition:background .18s,border-color .18s,color .18s,box-shadow .18s,transform .18s,opacity .18s; }
      button:active:enabled { transform:scale(.97); }
      .setting-row:hover:enabled { transform:translateX(2px); }
      .choice:hover:enabled { transform:translateX(3px); border-color:#ffffff50; }
      .choice[aria-pressed=true] .check { animation:check-in .22s cubic-bezier(.2,.8,.2,1); }
      input:focus,textarea:focus { border-color:#bdbdc9; box-shadow:0 0 0 3px #ffffff09; }
      #generate.is-busy>svg { animation:working-spin 2.2s linear infinite; }
      #generate.is-busy::after { content:''; position:absolute; inset:0; background:linear-gradient(110deg,transparent 20%,#00000013 50%,transparent 80%); animation:working-sweep 1.7s ease-in-out infinite; pointer-events:none; }
      @keyframes check-in { from { opacity:0; transform:scale(.55); } to { opacity:1; transform:scale(1); } }
      @keyframes working-spin { to { transform:rotate(360deg); } }
      @keyframes working-sweep { from { transform:translateX(-100%); } to { transform:translateX(100%); } }
    }

.notification-stack{position:fixed;z-index:2147483647;top:max(20px,env(safe-area-inset-top));right:max(20px,env(safe-area-inset-right));display:flex;flex-direction:column;gap:10px;width:300px;max-width:calc(100vw - 32px);max-height:25dvh;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4f4f5;isolation:isolate}
.notification{position:relative;display:flex;flex-shrink:0;align-items:flex-start;gap:11px;box-sizing:border-box;padding:15px 12px 15px 14px;width:100%;border:1px solid #303033;border-radius:15px;background:linear-gradient(135deg,#19191c,#101012);box-shadow:0 16px 45px #0005,0 3px 10px #0003,inset 0 1px 0 #ffffff07;pointer-events:auto;overflow-wrap:anywhere;transform-origin:top right}
.notification[hidden]{display:none!important}
.notification-icon{display:grid;place-items:center;flex:none;width:23px;height:23px;margin-top:1px;border:1px solid #525256;border-radius:50%;background:#ffffff09;color:#ededf0;font-size:13px;font-weight:700;line-height:1}
.notification[data-kind="error"] .notification-icon{color:#ffb5b5;border-color:#955151;background:#a33a3a1c}
.notification[data-kind="warning"] .notification-icon{color:#e8d09a;border-color:#80704c;background:#a485351a}
.notification-copy{min-width:0;flex:1;padding-top:2px}
.notification-title{display:block;font-size:12px;line-height:1.5;font-weight:650;letter-spacing:.01em;color:#f7f7f8}
.notification-message{margin:4px 0 0;color:#a9a9b1;font-size:11px;line-height:1.55}
.notification-message[hidden]{display:none!important}
.notification-dismiss{display:grid;place-items:center;flex:none;box-sizing:border-box;width:25px;height:25px;margin:-1px -2px 0 0;padding:0;border:0;border-radius:7px;background:transparent;color:#8e8e98;font:20px/1 Arial,sans-serif;cursor:pointer;transition:background .16s ease,color .16s ease,transform .16s ease}
.notification-dismiss:hover{background:#ffffff0d;color:#fff}
.notification-dismiss:active{transform:scale(.92)}
.notification-dismiss:focus-visible{outline:2px solid #d3d3dc;outline-offset:2px;color:#fff}
@media(max-width:560px){.notification-stack{top:max(12px,env(safe-area-inset-top));right:16px;left:16px;width:auto;max-width:none;gap:8px}.notification{border-radius:13px;padding-top:13px;padding-bottom:13px}}
@media(prefers-reduced-motion:reduce){.notification-dismiss{transition:none}}
  `);

  const contextInput = element('textarea', { id:'context', spellcheck:false, maxLength:MAX_CONTEXT, 'aria-describedby':'context-help context-count' });
  const themeInput = element('input', { id:'theme', placeholder:'Opcional: se vazio, inferir a partir do texto', maxLength:300 });
  const levelInput = element('select', { id:'level', hidden:true, 'aria-label':'Nível de escrita' }, [1,2,3,4,5].map(n => element('option',{value:String(n),selected:n === 3},String(n))));
  const wordsInput = element('select', { id:'words', hidden:true, 'aria-label':'Extensão aproximada' }, [250,350,500,700].map(n => element('option', { value:String(n), selected:n === 350 }, `${n} palavras`)));
  const instructionsInput = element('textarea', { id:'instructions', maxLength:2000, placeholder:'Opcional: tom, público, argumentos a desenvolver…' });
  const resultInput = element('textarea', { id:'result', readOnly:true, placeholder:'A redação aparecerá aqui.', 'aria-label':'Redação gerada' });
  const resultTitleInput = element('input', { id:'result-title', readOnly:true, 'aria-label':'Título gerado' });
  const status = element('p', { id:'status', role:'status', 'aria-live':'polite', 'aria-atomic':'true' }, 'Preparando leitura da página…');
  const counter = element('small', { id:'context-count', className:'counter' });
  const capturePage = element('button', { id:'capture-page', type:'button' }, 'Ler página');
  const captureSelection = element('button', { id:'capture-selection', type:'button' }, 'Ler seleção');
  const generateText = element('span', {}, 'Gerar redação');
  const generate = element('button', { id:'generate', type:'button', className:'primary' }, [icon('generate'),generateText]);
  const cancel = element('button', { id:'cancel', type:'button', hidden:true }, 'Cancelar');
  const retryConnection = element('button', { id:'retry-connection', type:'button', className:'full', hidden:true }, 'Gerar em janela auxiliar');
  const connectionHelp = element('a', { id:'connection-help', href:`${SERVICE_ORIGIN}/connection.html`, target:'_blank', rel:'noopener noreferrer', hidden:true }, 'Abrir hub em outra janela');
  const copy = element('button', { id:'copy', type:'button', disabled:true }, 'Copiar');
  const download = element('button', { id:'download', type:'button', disabled:true }, 'Baixar .txt');
  const fillPage = element('button', { id:'fill-page', type:'button', className:'full', disabled:true }, 'Preencher página');
  const pickTitle = element('button', { id:'pick-title', type:'button', disabled:true }, 'Escolher título');
  const pickEssay = element('button', { id:'pick-essay', type:'button', disabled:true }, 'Escolher redação');
  const fieldSearchStatus = element('p', { id:'field-search-status', className:'muted', role:'status', hidden:true });
  const stopFieldSearch = element('button', { id:'stop-field-search', type:'button', hidden:true }, 'Parar busca');
  const inspectFields = element('button', { id:'inspect-fields', type:'button', className:'full', 'aria-expanded':'false', 'aria-controls':'field-inspector' }, 'Ver campos da página');
  const fieldInspectorSummary = element('p', { id:'field-inspector-summary', role:'status' });
  const fieldInspectorList = element('div', { id:'field-inspector-list' });
  const fieldInspector = element('div', { id:'field-inspector', hidden:true }, [fieldInspectorSummary,fieldInspectorList]);
  const close = element('button', { id:'close', type:'button', className:'icon-button', 'aria-label':'Fechar hub', title:'Fechar' }, icon('close'));
  const minimize = element('button', { id:'minimize', type:'button', className:'icon-button', 'aria-label':'Recolher hub', title:'Recolher', 'aria-expanded':'true', 'aria-controls':'panel-body' }, '−');
  const summaries = {};
  const triggers = {};
  const paneInfo = {
    source:['Texto de referência','Escolha a origem e confira o conteúdo.'],
    genre:['Nível de escrita','Escolha como você quer que a redação seja escrita.'],
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
    element('div', { className:'settings' }, [setting('source','Referência'),setting('genre','Tipo'),setting('words','Extensão'),setting('writing','Tema'),setting('result','Redação')]),
    element('div', { className:'generate-row' }, [generate,cancel]),status,retryConnection,connectionHelp
  ]);
  const main = element('section', { id:'main-panel', className:'card main', role:'region', 'aria-label':'Redator Batata', 'data-secondary-open':'false' }, [
    element('header', { className:'hub-header' }, [element('span',{ className:'brand-icon' },icon('brand')),element('div',{ className:'brand' },[element('h2',{},'Redator'),element('span',{ className:'badge' },'BATATA'),element('span',{ id:'version', className:'badge', title:'Versão do hub' },`v${VERSION}`)]),minimize,close]),body
  ]);
  const saveSource = element('button', { id:'save-source', type:'button', className:'primary full' }, 'Usar este texto');
  const saveWriting = element('button', { id:'save-writing', type:'button', className:'primary full' }, 'Usar estas instruções');
  const levelOptions = [
    [1,'Bem simples','Frases curtas, vocabulário comum, pouca elaboração'],
    [2,'Fraco','Estrutura simples, argumentos pouco aprofundados'],
    [3,'Médio','Aluno mediano do ensino médio — o mais natural'],
    [4,'Bom','Bem organizado, vocabulário variado, boa coesão'],
    [5,'Máximo','A melhor resposta possível para a proposta']
  ];
  const wordOptions = [[250,'Breve'],[350,'Equilibrada'],[500,'Detalhada'],[700,'Longa']];
  function choice(kind,value,label,description) {
    return element('button',{ id:`choice-${kind}-${value}`, type:'button', className:'choice', 'data-choice':kind, 'data-value':String(value), 'aria-pressed':'false' },[
      element('span',{ className:'choice-copy' },[element('span',{ className:'choice-label' },label),element('span',{ className:'choice-description' },description)]),element('span',{ className:'check', 'aria-hidden':'true' },'✓')
    ]);
  }
  const panes = {
    source:element('div',{ id:'pane-source', className:'pane', hidden:true },[
      element('div',{ className:'row' },[capturePage,captureSelection]),
      element('label',{ htmlFor:'context' },'Texto de referência'),contextInput,counter,
      element('p',{ id:'context-help', className:'muted' },'Confira o conteúdo antes de gerar. Este texto será enviado para gerar a redação.'),saveSource
    ]),
    genre:element('div',{ id:'pane-genre', className:'pane', hidden:true },[levelInput,...levelOptions.map(([value,label,desc]) => choice('level',value,`${value} — ${label}`,desc))]),
    words:element('div',{ id:'pane-words', className:'pane', hidden:true },[wordsInput,...wordOptions.map(([value,desc]) => choice('words',value,`${value} palavras`,desc))]),
    writing:element('div',{ id:'pane-writing', className:'pane', hidden:true },[
      element('label',{ htmlFor:'theme' },'Tema'),themeInput,
      element('label',{ htmlFor:'instructions' },'Instruções adicionais'),instructionsInput,
      element('small',{},'Sem tema? O assunto será identificado pelo texto de referência.'),saveWriting
    ]),
    result:element('div',{ id:'pane-result', className:'pane', hidden:true },[
      element('label',{ htmlFor:'result-title' },'Título gerado'),resultTitleInput,
      element('label',{ htmlFor:'result' },'Redação gerada'),resultInput,
      element('small',{ id:'result-count', className:'counter' },'0 palavras'),
      element('div',{ className:'row actions' },[copy,download]),fillPage,
      fieldSearchStatus,stopFieldSearch,
      element('div',{ className:'row actions' },[pickTitle,pickEssay]),inspectFields,fieldInspector
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

  // BEGIN_HUB_MOTION
  function createHubMotion({shadow,host,reducedMotion}){
    const doc=host.ownerDocument, win=doc.defaultView;
    const media=win.matchMedia?win.matchMedia('(prefers-reduced-motion: reduce)'):null;
    const animations=new Map(), revisions=new WeakMap(), notices=new Map();
    let disposed=false, sequence=0;
    const stack=doc.createElement('div');
    stack.className='notification-stack';
    stack.id='notifications';
    stack.setAttribute('aria-label','Notificações');
    shadow.appendChild(stack);
    const reduce=()=>{
      try{return !!(media&&media.matches)||(typeof reducedMotion==='function'?!!reducedMotion():typeof reducedMotion==='object'?!!reducedMotion?.matches:!!reducedMotion);}
      catch(_){return !!(media&&media.matches);}
    };
    function stop(element){
      const revision=(revisions.get(element)||0)+1;
      revisions.set(element,revision);
      const current=animations.get(element);
      if(current){animations.delete(element);try{current.cancel();}catch(_){}}
      return revision;
    }
    function play(element,frames,options){
      if(disposed||!element.isConnected||reduce()||typeof element.animate!=='function')return null;
      try{
        const animation=element.animate(frames,options);
        animations.set(element,animation);
        const clear=()=>{if(animations.get(element)===animation)animations.delete(element);};
        animation.finished.then(clear,clear);
        return animation;
      }catch(_){return null;}
    }
    function enter(element,kind='panel'){
      if(disposed||!element)return;
      stop(element);
      element.hidden=false;
      const distance=kind==='notification'?'10px':'7px';
      const frames=kind==='body' ? [
        {height:'0px',opacity:0,paddingBottom:'0px',overflow:'hidden'},
        {height:element.scrollHeight+'px',opacity:1,paddingBottom:'10px',overflow:'hidden'}
      ] : [
        {opacity:0,transform:kind==='notification'?'translateX('+distance+')':'translateY('+distance+') scale(.985)'},
        {opacity:1,transform:'translate(0,0) scale(1)'}
      ];
      return play(element,frames,{duration:kind==='notification'?220:190,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
    async function exit(element,{remove=false,hide=true,collapse=false}={}){
      if(disposed||!element)return false;
      const revision=stop(element);
      const frames=collapse ? [
        {height:element.getBoundingClientRect().height+'px',opacity:1,paddingBottom:'10px',overflow:'hidden'},
        {height:'0px',opacity:0,paddingBottom:'0px',overflow:'hidden'}
      ] : [{opacity:1,transform:'translate(0,0) scale(1)'},{opacity:0,transform:'translateY(-5px) scale(.985)'}];
      const animation=play(element,frames,{duration:140,easing:'ease-in'});
      if(animation){try{await animation.finished;}catch(_){return false;}}
      if(disposed||revisions.get(element)!==revision||!element.isConnected)return false;
      if(remove)element.remove();
      else if(hide)element.hidden=true;
      return true;
    }
    function pulse(element){
      if(disposed||!element)return;
      stop(element);
      return play(element,[{transform:'scale(1)'},{transform:'scale(1.025)'},{transform:'scale(1)'}],{duration:210,easing:'ease-out'});
    }
    function busy(button,value){
      if(disposed||!button)return;
      button.classList.toggle('is-busy',!!value);
    }
    function clearTimer(record){
      if(record.timer!==null){win.clearTimeout(record.timer);record.timer=null;}
    }
    function arm(record){
      clearTimer(record);
      if(record.closing||record.hovered||record.focused||record.remaining<=0||disposed)return;
      record.started=Date.now();
      record.timer=win.setTimeout(()=>{record.timer=null;dismiss(record);},record.remaining);
    }
    function pause(record){
      if(record.timer!==null){record.remaining=Math.max(1,record.remaining-(Date.now()-record.started));clearTimer(record);}
    }
    function removeNow(record){
      clearTimer(record);
      stop(record.node);
      record.node.remove();
      if(notices.get(record.id)===record)notices.delete(record.id);
    }
    function dismiss(record){
      if(disposed||record.closing||notices.get(record.id)!==record)return;
      clearTimer(record);
      record.closing=true;
      exit(record.node,{remove:true,hide:false}).then(removed=>{
        if(removed&&record.closing&&notices.get(record.id)===record)notices.delete(record.id);
      });
    }
    function toast({id,title,message='',kind='success',duration}={}){
      if(disposed)return ()=>{};
      id=id==null?'notice-'+(++sequence):String(id);
      kind=['success','error','warning','info'].includes(kind)?kind:'info';
      let record=notices.get(id);
      if(!record){
        while(notices.size>=3)removeNow(notices.values().next().value);
        const node=doc.createElement('div'), icon=doc.createElement('span');
        const copy=doc.createElement('div'), heading=doc.createElement('strong');
        const detail=doc.createElement('p'), close=doc.createElement('button');
        node.className='notification';
        icon.className='notification-icon';
        icon.setAttribute('aria-hidden','true');
        copy.className='notification-copy';
        heading.className='notification-title';
        detail.className='notification-message';
        close.className='notification-close notification-dismiss';
        close.type='button';
        close.textContent='×';
        close.setAttribute('aria-label','Fechar notificação');
        copy.append(heading,detail);
        node.append(icon,copy,close);
        record={id,node,icon,heading,detail,timer:null,remaining:0,started:0,hovered:false,focused:false,closing:false};
        close.addEventListener('click',()=>dismiss(record));
        node.addEventListener('mouseenter',()=>{record.hovered=true;pause(record);});
        node.addEventListener('mouseleave',()=>{record.hovered=false;arm(record);});
        node.addEventListener('focusin',()=>{record.focused=true;pause(record);});
        node.addEventListener('focusout',event=>{
          if(!node.contains(event.relatedTarget)){record.focused=false;arm(record);}
        });
        notices.set(id,record);
        stack.appendChild(node);
      }
      clearTimer(record);
      record.closing=false;
      record.node.dataset.kind=kind;
      record.node.dataset.notificationId=id;
      record.node.setAttribute('role',kind==='error'?'alert':'status');
      record.node.setAttribute('aria-live',kind==='error'?'assertive':'polite');
      record.node.setAttribute('aria-atomic','true');
      record.icon.textContent=kind==='success'?'✓':kind==='error'?'!':kind==='warning'?'!':'i';
      record.heading.textContent=String(title==null?'':title);
      record.detail.textContent=String(message==null?'':message);
      record.detail.hidden=!record.detail.textContent;
      const requested=Number(duration);
      record.remaining=duration!=null&&Number.isFinite(requested)&&requested>=0?requested:kind==='error'?7000:5000;
      enter(record.node,'notification');
      stack.scrollTop=stack.scrollHeight;
      arm(record);
      return ()=>dismiss(record);
    }
    function dispose(){
      if(disposed)return;
      disposed=true;
      notices.forEach(record=>clearTimer(record));
      notices.clear();
      animations.forEach(animation=>{try{animation.cancel();}catch(_){}});
      animations.clear();
      stack.remove();
    }
    return {toast,enter,exit,pulse,busy,dispose};
  }
  // END_HUB_MOTION
  const hubMotion = createHubMotion({shadow,host});
  hubMotion.enter(main);

  // BEGIN_PAGE_FILL
  /** Local, conservative form discovery and filling; never submits a form. */
  function createPageFill({ excludeRoot, onStatus } = {}) {
    const pinned = { title: null, essay: null };
    const fieldSelector = 'input,textarea,[contenteditable],[role="textbox"]';
    let disposed = false;
    let pendingPick = null;
    const fieldWaiters = new Set();

    const normalize = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const titleCue = /\b(titulo|title)\b/;
    const essayCue = /\b(redacao|essay|composition|desenvolvimento)\b|\b(seu|sua|your) (texto|redacao|text|essay)\b|\b(corpo do texto|texto da resposta|escreva (aqui|seu texto)|digite seu texto)\b/;
    const unrelated = /\b(referencia|reference|apoio|proposta|enunciado|prompt|contexto|context|instrucao|instrucoes|motivador|motivadores|pesquisa|pesquisar|search|busca|email|e mail|senha|password|usuario|username|login|telefone|phone|comentario|comment|mensagem|message|chat|feedback|observacao|tema|theme|subject)\b|\bnome completo\b/;
    const referenceHeading = /\b(texto de apoio|textos de apoio|proposta|enunciado|referencia|instrucoes|prompt|contexto)\b/;
    const muiTextarea = node => node?.tagName === 'TEXTAREA' && node.classList.contains('MuiInputBase-input') && node.classList.contains('MuiInputBase-inputMultiline');
    const parentOf = node => node?.parentElement || node?.getRootNode?.()?.host || null;
    function notify(result) { try { onStatus?.(result); } catch (_) {} }

    function excluded(node) {
      for (let current = node; current; current = parentOf(current)) {
        if (current === excludeRoot || current.id === 'redator-batata-console') return true;
      }
      return false;
    }

    function editable(node, kind) {
      if (!node?.ownerDocument || !node.isConnected || excluded(node)) return false;
      const tag = node.tagName?.toLowerCase();
      if (tag === 'input') {
        if (kind === 'essay' || !['text', ''].includes((node.getAttribute('type') || 'text').toLowerCase())) return false;
      } else if (tag !== 'textarea' && !node.isContentEditable) return false;
      if (node.disabled || node.readOnly || node.matches?.(':disabled')) return false;
      try {
        for (let context = node; context; context = context.ownerDocument.defaultView.frameElement) {
          if (!context.getClientRects().length || excluded(context)) return false;
          for (let current = context; current; current = parentOf(current)) {
            const hiddenFromAccess = current.getAttribute?.('aria-hidden') === 'true';
            // aria-hidden em um contêiner não torna uma caixa visível não editável.
            // A própria textarea e os espelhos de medição continuam excluídos.
            const staleMuiAncestor = context === node && muiTextarea(node) && current !== node;
            // Form controls named "hidden" or "inert" can shadow these DOM properties.
            if (current.hasAttribute('hidden') || current.hasAttribute('inert') || (hiddenFromAccess && !staleMuiAncestor) ||
                current.getAttribute?.('aria-disabled') === 'true' || current.getAttribute?.('aria-readonly') === 'true') return false;
            const style = current.ownerDocument.defaultView.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
          }
        }
      } catch (_) { return false; }
      return true;
    }

    function fieldFrom(node) {
      let element = node?.nodeType === 1 ? node : node?.parentElement;
      if (element?.tagName === 'LABEL' && element.control) element = element.control;
      for (; element; element = parentOf(element)) {
        if (element.matches?.('input,textarea')) return element;
        if (element.isContentEditable) {
          while (element.parentElement?.isContentEditable) element = element.parentElement;
          return element;
        }
        if (element.getAttribute?.('contenteditable') === 'false') return null;
      }
      return null;
    }

    // Include open shadow roots and accessible editor frames, without touching cross-origin frames.
    function collect() {
      const fields = new Set();
      const textareas = new Set();
      const documents = new Set();
      const roots = new Set();
      const frames = new Set();
      const seen = new Set();
      const pending = [{ root: document, depth: 0 }];
      let scanned = 0;
      let inaccessibleFrames = 0;
      while (pending.length) {
        const { root, depth } = pending.shift();
        if (seen.has(root)) continue;
        seen.add(root);
        roots.add(root);
        if (root.nodeType === 9) documents.add(root);
        // Controls and frames come first, including after large read-only page content.
        for (const element of root.querySelectorAll(fieldSelector)) {
          if (excluded(element)) continue;
          if (element.tagName === 'TEXTAREA') textareas.add(element);
          const field = fieldFrom(element);
          if (field && editable(field)) fields.add(field);
        }
        if (depth < 3) for (const element of root.querySelectorAll('iframe')) {
          if (excluded(element)) continue;
          frames.add(element);
          if (element.getClientRects().length) {
            try {
              if (element.contentDocument?.documentElement) pending.push({ root: element.contentDocument, depth: depth + 1 });
              else if (element.contentWindow) inaccessibleFrames++;
            } catch (_) { inaccessibleFrames++; }
          }
        }
        if (scanned < 30000) for (const element of root.querySelectorAll('*')) {
          if (++scanned > 30000) break;
          if (!excluded(element) && element.shadowRoot) pending.push({ root: element.shadowRoot, depth });
        }
      }
      return { fields: [...fields], textareas: [...textareas], documents: [...documents], roots, frames, inaccessibleFrames };
    }

    function labelText(node) {
      if (!node) return '';
      const parts = [];
      const walker = node.ownerDocument.createTreeWalker(node, 4);
      let text;
      while ((text = walker.nextNode()) && parts.join(' ').length < 300) {
        if (!text.parentElement?.closest('input,textarea,[contenteditable]')) parts.push(text.textContent);
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    }

    function nearbyFieldLabel(node) {
      if (!node || node.matches?.('input,textarea,[contenteditable],script,style')) return '';
      const text = labelText(node);
      const cue = normalize(text);
      if (text.length > 100) return '';
      return titleCue.test(cue) || essayCue.test(cue) || unrelated.test(cue) ? text : '';
    }

    function describe(element) {
      const root = element.getRootNode();
      const labels = [...(element.labels || [])].map(labelText);
      if (element.closest('label')) labels.push(labelText(element.closest('label')));
      for (const id of (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
        const node = root.getElementById?.(id) || element.ownerDocument.getElementById(id);
        labels.push(labelText(node));
      }
      labels.push(element.getAttribute('aria-label') || '', element.getAttribute('placeholder') || '', element.getAttribute('data-placeholder') || '');
      const group = element.closest('.MuiFormControl-root,.form-group,[data-field]');
      if (!labels.some(Boolean) && group) {
        for (const label of group.querySelectorAll('label')) labels.push(labelText(label));
        const localFields = [...group.querySelectorAll(fieldSelector)].map(fieldFrom).filter((node, index, all) => node && all.indexOf(node) === index && editable(node));
        if (localFields.length === 1 && localFields[0] === element) {
          for (const label of group.querySelectorAll('p,span,.MuiTypography-root')) {
            const text = nearbyFieldLabel(label);
            if (text) labels.push(text);
          }
        }
      }
      let heading = '';
      for (let current = element, level = 0; current && level < 4 && !heading; current = current.parentElement, level++) {
        const previous = current.previousElementSibling;
        if (previous?.matches('label,h1,h2,h3,h4,h5,h6,legend')) heading = labelText(previous);
        else if (previous?.matches('header')) heading = labelText(previous.querySelector('h1,h2,h3,h4,h5,h6'));
        else if (previous?.matches('p,span,.MuiTypography-root')) heading = nearbyFieldLabel(previous);
      }
      const attrs = ['name', 'id', 'title', 'data-testid', 'data-field'].map(name => element.getAttribute(name) || '').join(' ');
      const direct = normalize(labels.join(' ') + ' ' + attrs);
      return {
        element, direct, heading: normalize(heading),
        label: (labels.find(Boolean) || heading || element.getAttribute('name') || element.id || element.tagName).slice(0, 100),
        form: element.form || element.closest('form,[role="form"]'),
        titleScore: titleCue.test(direct) ? 120 : !referenceHeading.test(normalize(heading)) && titleCue.test(normalize(heading)) ? 95 : 0,
        essayScore: essayCue.test(direct) ? 120 : !referenceHeading.test(normalize(heading)) && essayCue.test(normalize(heading)) ? 95 : 0
      };
    }

    function muiEditorPair(descriptions) {
      const fields = descriptions.filter(item => muiTextarea(item.element));
      if (fields.length > 2) return { pair:null, ambiguous:true };
      if (fields.length !== 2 || fields[0].element.ownerDocument !== fields[1].element.ownerDocument ||
          fields[0].element.getRootNode() !== fields[1].element.getRootNode()) return { pair:null, ambiguous:false };
      const [first,second] = fields.map(item => item.element);
      let common = first.parentElement;
      while (common && !common.contains(second)) common = common.parentElement;
      if (!common || !common.contains(second) || common.matches('html,body,main,[role="main"],#root,#__next')) return { pair:null, ambiguous:false };
      if (first.form !== second.form && (first.form || second.form)) return { pair:null, ambiguous:false };
      if (descriptions.some(item => common.contains(item.element) && !fields.includes(item))) return { pair:null, ambiguous:true };
      return { pair:fields, ambiguous:false };
    }

    function detect(allowDisposed = false, snapshot = null) {
      if (disposed && !allowDisposed) return { title: null, essay: null, status: 'not-found', ambiguous: { title: false, essay: false }, candidates: { title: [], essay: [] }, message: 'Preenchimento encerrado.' };
      for (const kind of ['title', 'essay']) if (pinned[kind] && !editable(pinned[kind], kind)) pinned[kind] = null;
      const descriptions = (snapshot || collect()).fields.map(describe).filter(item => !unrelated.test(item.direct) &&
        (!referenceHeading.test(item.heading) || item.titleScore >= 120 || item.essayScore >= 120 ||
          (muiTextarea(item.element) && /\bproposta\b/.test(item.heading) && !/\b(apoio|referencia|contexto|instrucoes|enunciado|prompt)\b/.test(item.heading))));
      let titles = descriptions.filter(item => item.titleScore && item.element !== pinned.essay && editable(item.element, 'title'));
      let essays = descriptions.filter(item => item.essayScore && !item.titleScore && item.element !== pinned.title && editable(item.element, 'essay'));
      const topTitleScore = titles.reduce((score, item) => Math.max(score, item.titleScore), 0);
      const topEssayScore = essays.reduce((score, item) => Math.max(score, item.essayScore), 0);
      titles = titles.filter(item => item.titleScore === topTitleScore);
      essays = essays.filter(item => item.essayScore === topEssayScore);
      const editor = muiEditorPair(descriptions);
      // Explicit title/body labels take precedence over unrelated extra controls.
      if (!editor.pair && titles.length === 1 && essays.length === 1) editor.ambiguous = false;
      if (editor.pair && [...titles,...essays].some(item => !editor.pair.some(candidate => candidate.element === item.element))) editor.ambiguous = true;
      if (editor.pair && !editor.ambiguous) {
        const [first,second] = editor.pair;
        if (!titles.length && !essays.length) {
          if (!pinned.title && first.element !== pinned.essay) titles = [{...first,titleScore:85}];
          if (!pinned.essay && second.element !== pinned.title) essays = [{...second,essayScore:85}];
        } else if (!essays.length && titles.length === 1) {
          const other = editor.pair.find(item => item.element !== titles[0].element && item.element !== pinned.title);
          if (other) essays = [{...other,essayScore:85}];
        } else if (!titles.length && essays.length === 1) {
          const other = editor.pair.find(item => item.element !== essays[0].element && item.element !== pinned.essay);
          if (other) titles = [{...other,titleScore:85}];
        }
      }
      const chosenTitle = pinned.title || (titles.length === 1 ? titles[0].element : null);
      const titleForm = chosenTitle && (chosenTitle.form || chosenTitle.closest('form,[role="form"]'));
      if (!essays.length && titleForm) {
        const paired = descriptions.filter(item => item.element !== chosenTitle && item.form === titleForm &&
          !item.titleScore && editable(item.element, 'essay') &&
          (item.element.tagName !== 'TEXTAREA' || item.element.rows >= 4 || item.element.getBoundingClientRect().height >= 90));
        if (paired.length === 1) essays = [{ ...paired[0], essayScore: 85 }];
      }
      const candidates = {
        title: titles.map(item => ({ element: item.element, label: item.label, score: item.titleScore })),
        essay: essays.map(item => ({ element: item.element, label: item.label, score: item.essayScore }))
      };
      const title = pinned.title || (titles.length === 1 ? titles[0].element : null);
      const essay = pinned.essay || (essays.length === 1 ? essays[0].element : null);
      const ambiguous = { title: !pinned.title && (titles.length > 1 || editor.ambiguous), essay: !pinned.essay && (essays.length > 1 || editor.ambiguous) };
      const status = ambiguous.title || ambiguous.essay ? 'ambiguous' : title && essay ? 'ready' : title || essay ? 'partial' : 'not-found';
      const message = status === 'ready' ? 'Título e redação encontrados na página.' : status === 'ambiguous'
        ? 'Há mais de um campo possível. Escolha o campo na página.' : status === 'partial'
          ? `${essay ? 'Redação encontrada; título' : 'Título encontrado; redação'} sem campo identificado.`
          : 'Campos de redação não encontrados. Você pode escolhê-los na página.';
      return { title, essay, status, ambiguous, candidates, message };
    }

    function inspect() {
      const snapshot = collect();
      const detection = detect(false, snapshot);
      function rejection(element) {
        if (!element.isConnected || excluded(element)) return 'unavailable';
        if (element.disabled || element.matches(':disabled')) return 'disabled';
        if (element.readOnly) return 'readonly';
        if (element.getAttribute('aria-hidden') === 'true') return 'aria-hidden';
        try {
          for (let context = element; context; context = context.ownerDocument.defaultView.frameElement) {
            if (!context.getClientRects().length) return 'not-visible';
            for (let current = context; current; current = parentOf(current)) {
              if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute?.('aria-disabled') === 'true' ||
                  current.getAttribute?.('aria-readonly') === 'true') return 'inert-or-ancestor';
              if (current.getAttribute?.('aria-hidden') === 'true' &&
                  !(context === element && muiTextarea(element) && current !== element)) return 'aria-hidden';
              const style = current.ownerDocument.defaultView.getComputedStyle(current);
              if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return 'not-visible';
            }
          }
        } catch (_) { return 'unavailable'; }
        return 'unavailable';
      }
      const fields = snapshot.textareas.map(element => {
        const available = editable(element);
        const labels = [...(element.labels || [])].map(labelText);
        if (element.closest('label')) labels.push(labelText(element.closest('label')));
        return { element, id: element.id, label: (labels.find(Boolean) || '').slice(0, 100), editable: available,
          reason: available ? '' : rejection(element) };
      });
      return {
        status: detection.status, message: detection.message,
        textareaCount: fields.length, editableTextareaCount: fields.filter(field => field.editable).length,
        candidateCounts: { title: detection.candidates.title.length, essay: detection.candidates.essay.length },
        fields, inaccessibleFrames: snapshot.inaccessibleFrames
      };
    }

    function waitForTargets({ signal, onWaiting } = {}) {
      if (disposed || signal?.aborted) return Promise.resolve(null);
      return new Promise(resolve => {
        let finished = false;
        let debounce = null;
        let interval = null;
        const observers = new Map();
        const frameListeners = new Map();
        const attributes = ['hidden','inert','disabled','readonly','aria-hidden','aria-disabled','aria-readonly',
          'style','class','id','name','title','type','role','contenteditable','aria-label','aria-labelledby',
          'placeholder','data-placeholder','data-testid','data-field','for','rows','src','srcdoc'];

        function finish(result) {
          if (finished) return;
          finished = true;
          window.clearTimeout(debounce);
          window.clearInterval(interval);
          for (const observer of observers.values()) observer.disconnect();
          for (const [frame, listener] of frameListeners) frame.removeEventListener('load', listener);
          observers.clear(); frameListeners.clear();
          signal?.removeEventListener('abort', cancel);
          fieldWaiters.delete(check);
          resolve(result);
        }
        const cancel = () => finish(null);
        function schedule() {
          if (finished) return;
          window.clearTimeout(debounce);
          debounce = window.setTimeout(check, 150);
        }
        function changed(records) {
          const relevant = records.some(record => {
            if (excluded(record.target)) return false;
            if (record.type !== 'childList') return true;
            return [...record.addedNodes, ...record.removedNodes].some(node => !excluded(node));
          });
          if (relevant) schedule();
        }
        function observe(snapshot) {
          for (const [root, observer] of observers) if (!snapshot.roots.has(root)) {
            observer.disconnect(); observers.delete(root);
          }
          for (const root of snapshot.roots) if (!observers.has(root)) {
            try {
              const win = (root.ownerDocument || root).defaultView;
              const observer = new win.MutationObserver(changed);
              observer.observe(root, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:attributes });
              observers.set(root, observer);
            } catch (_) {}
          }
          for (const [frame, listener] of frameListeners) if (!snapshot.frames.has(frame)) {
            frame.removeEventListener('load', listener); frameListeners.delete(frame);
          }
          for (const frame of snapshot.frames) if (!frameListeners.has(frame)) {
            frame.addEventListener('load', schedule); frameListeners.set(frame, schedule);
          }
        }
        function check() {
          if (finished) return;
          window.clearTimeout(debounce); debounce = null;
          if (disposed || signal?.aborted) { finish(null); return; }
          const snapshot = collect();
          const detection = detect(false, snapshot);
          if (detection.title && detection.essay && !detection.ambiguous.title && !detection.ambiguous.essay) {
            finish(detection); return;
          }
          observe(snapshot);
          try { onWaiting?.(detection); } catch (_) {}
        }
        fieldWaiters.add(check);
        signal?.addEventListener('abort', cancel, { once:true });
        // Polling also notices SPA navigation, new shadow roots and property-only changes.
        // It remains independent of the debounce so continuous mutations cannot starve discovery.
        interval = window.setInterval(check, 1000);
        check();
      });
    }

    function setTargets(targets = {}) {
      for (const kind of ['title', 'essay']) {
        if (!Object.prototype.hasOwnProperty.call(targets, kind)) continue;
        const node = targets[kind];
        if (node != null && !editable(node, kind)) throw new TypeError(`Campo de ${kind === 'title' ? 'título' : 'redação'} indisponível.`);
        const other = kind === 'title' ? 'essay' : 'title';
        if (node && node === (Object.prototype.hasOwnProperty.call(targets, other) ? targets[other] : pinned[other])) throw new TypeError('Escolha campos diferentes para título e redação.');
      }
      for (const kind of ['title', 'essay']) if (Object.prototype.hasOwnProperty.call(targets, kind)) pinned[kind] = targets[kind] || null;
      const detection = detect();
      for (const wake of [...fieldWaiters]) wake();
      return detection;
    }

    function dispatchInput(element, text) {
      const win = element.ownerDocument.defaultView;
      let event;
      try { event = new win.InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: text }); }
      catch (_) { event = new win.Event('input', { bubbles: true, composed: true }); }
      element.dispatchEvent(event);
      element.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }));
    }

    const canonical = value => String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
    const read = element => element.matches('input,textarea') ? element.value : element.innerText || element.textContent || '';
    const escapeText = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    function publicEditor(element, text) {
      const local = element.ownerDocument.defaultView;
      for (const win of [...new Set([local, window])]) {
        try {
          const editors = win.tinymce?.get?.();
          const editor = Array.isArray(editors) && editors.find(item => item.getBody?.() === element);
          if (editor?.setContent) {
            editor.setContent(text.split(/\n\s*\n/).map(paragraph => `<p>${escapeText(paragraph).replace(/\n/g, '<br>')}</p>`).join(''));
            editor.fire?.('input'); editor.fire?.('change');
            return true;
          }
        } catch (_) {}
        try {
          const editor = win.Quill?.find?.(element);
          if (editor?.root === element && typeof editor.setText === 'function') { editor.setText(text, 'user'); return true; }
        } catch (_) {}
      }
      return false;
    }

    function write(element, text) {
      const doc = element.ownerDocument;
      const win = doc.defaultView;
      if (element.matches('input,textarea')) {
        const prototype = element.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
        dispatchInput(element, text);
        return;
      }
      if (publicEditor(element, text)) { dispatchInput(element, text); return; }
      const active = doc.activeElement;
      const selection = doc.getSelection();
      const ranges = [];
      for (let i = 0; selection && i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
      try {
        element.focus({ preventScroll: true });
        const range = doc.createRange(); range.selectNodeContents(element);
        selection?.removeAllRanges(); selection?.addRange(range);
        // Native editing lets rich editors observe a normal browser editing transaction.
        const inserted = doc.execCommand?.('insertText', false, text);
        if (!inserted || canonical(read(element)) !== canonical(text)) {
          const fragment = doc.createDocumentFragment();
          for (const paragraph of text.split(/\n\s*\n/)) {
            const p = doc.createElement('p');
            paragraph.split('\n').forEach((line, index) => { if (index) p.append(doc.createElement('br')); p.append(doc.createTextNode(line)); });
            fragment.append(p);
          }
          element.replaceChildren(fragment);
          dispatchInput(element, text);
        }
      } finally {
        if (active?.isConnected && active !== element) active.focus?.({ preventScroll: true });
        if (selection) {
          selection.removeAllRanges();
          for (const range of ranges) try { selection.addRange(range); } catch (_) {}
        }
      }
    }

    async function fill({ title, essay, signal, preserveTargets = {} } = {}) {
      const result = { filledTitle: false, filledEssay: false, status: 'invalid', message: '', errors: [] };
      const writes = [];
      const preserved = [];
      const stopped = () => disposed || signal?.aborted;
      const settle = () => new Promise(resolve => {
        // Deixa o estado do site atualizar antes de iniciar a espera de renderização.
        window.setTimeout(() => {
          const timer = window.setTimeout(resolve, 60);
          window.requestAnimationFrame?.(() => window.requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
        },0);
      });
      async function rollback() {
        for (const entry of [...writes].reverse()) {
          try {
            const target = editable(entry.target, entry.kind) ? entry.target : detect(true)[entry.kind];
            // A user edit made after our write always takes precedence over restoration.
            if (!editable(target, entry.kind) || entry.written == null || read(target) !== entry.written) continue;
            write(target, entry.previous);
            await settle();
          } catch (_) {}
        }
        result.status = 'cancelled';
        result.message = 'Preenchimento cancelado.';
        return result;
      }
      if (stopped()) return rollback();
      if (typeof essay !== 'string' || !essay.trim()) { result.message = 'A redação está vazia; nenhum campo foi preenchido.'; return result; }
      let detection = detect();
      if (detection.ambiguous.title || detection.ambiguous.essay) {
        result.status = 'ambiguous'; result.message = detection.message; return result;
      }
      // Separate React renders: both onChange handlers may spread the same parent state.
      for (const [kind, text] of [['title', typeof title === 'string' ? title.trim() : ''], ['essay', essay.trim()]]) {
        if (stopped()) return rollback();
        detection = detect();
        if (detection.ambiguous.title || detection.ambiguous.essay) break;
        const target = detection[kind];
        if (!target || !text) continue;
        if (preserveTargets?.[kind] === target) { preserved.push({ kind, target }); continue; }
        if (!editable(target, kind)) { result.errors.push(`O campo de ${kind === 'title' ? 'título' : 'redação'} ficou indisponível.`); continue; }
        const max = target.matches('input,textarea') ? target.maxLength : -1;
        if (max >= 0 && text.length > max) { result.errors.push(`O campo de ${kind === 'title' ? 'título' : 'redação'} aceita até ${max} caracteres; o texto foi preservado no hub.`); continue; }
        try {
          if (stopped()) return rollback();
          const entry = { kind, target, text, previous: read(target), written: null };
          writes.push(entry);
          write(target, text);
          if (canonical(read(target)) === canonical(text)) entry.written = read(target);
          await settle();
          if (stopped()) return rollback();
        }
        catch (_) { result.errors.push(`Não foi possível preencher o campo de ${kind === 'title' ? 'título' : 'redação'}.`); }
      }
      if (stopped()) return rollback();
      if (writes.length || preserved.length) {
        detection = detect();
        for (const { kind, target } of preserved) {
          if (detection[kind] === target && editable(target, kind) && canonical(read(target))) result[kind === 'title' ? 'filledTitle' : 'filledEssay'] = true;
        }
        for (const { kind, text } of writes) {
          const target = detection[kind];
          if (editable(target, kind) && canonical(read(target)) === canonical(text)) result[kind === 'title' ? 'filledTitle' : 'filledEssay'] = true;
          else result.errors.push(`A página não manteve o ${kind === 'title' ? 'título' : 'texto'} preenchido. Escolha outro campo ou copie a redação.`);
        }
      }
      result.status = result.filledTitle && result.filledEssay ? 'filled' : result.filledTitle || result.filledEssay ? 'partial' : result.errors.length ? 'error' : detection.status;
      result.message = result.filledTitle && result.filledEssay ? 'Título e redação preenchidos na página. Revise antes de enviar.'
        : result.filledEssay ? 'Redação preenchida. O título continua disponível no hub.'
          : result.filledTitle ? 'Título preenchido. Escolha o campo de redação ou copie o texto.'
            : result.errors[0] || detection.message;
      if ((result.filledTitle || result.filledEssay) && result.errors.length) result.message += ` ${result.errors[0]}`;
      return result;
    }

    function pick(kind) {
      if (!['title', 'essay'].includes(kind)) return Promise.reject(new TypeError('Campo inválido.'));
      if (disposed) return Promise.resolve(null);
      cancelPick();
      return new Promise(resolve => {
        const { documents } = collect();
        const listeners = [];
        function finish(element) {
          for (const [doc, event, handler] of listeners) doc.removeEventListener(event, handler, true);
          pendingPick = null;
          if (element) setTargets({ [kind]: element });
          notify(element ? { status: 'selected', message: `Campo de ${kind === 'title' ? 'título' : 'redação'} escolhido.` } : { status: 'cancelled', message: 'Escolha de campo cancelada.' });
          resolve(element);
        }
        const cancel = () => finish(null);
        pendingPick = cancel;
        function click(event) {
          if (event.composedPath().some(node => node === excludeRoot || node?.id === 'redator-batata-console')) return;
          event.preventDefault(); event.stopImmediatePropagation();
          const target = fieldFrom(event.composedPath()[0]);
          if (!editable(target, kind) || target === pinned[kind === 'title' ? 'essay' : 'title']) {
            notify({ status: 'picking', message: 'Clique em um campo de texto editável e diferente do outro campo. Esc cancela.' }); return;
          }
          finish(target);
        }
        function pointer(event) {
          if (!event.composedPath().some(node => node === excludeRoot || node?.id === 'redator-batata-console')) { event.preventDefault(); event.stopImmediatePropagation(); }
        }
        function key(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } }
        for (const doc of documents) for (const [event, handler] of [['click', click], ['pointerdown', pointer], ['keydown', key]]) {
          doc.addEventListener(event, handler, true); listeners.push([doc, event, handler]);
        }
        notify({ status: 'picking', message: `Clique no campo de ${kind === 'title' ? 'título' : 'redação'} na página. Esc cancela.` });
      });
    }

    function cancelPick() { pendingPick?.(); }
    function dispose() {
      disposed = true; cancelPick(); pinned.title = null; pinned.essay = null;
      for (const wake of [...fieldWaiters]) wake();
    }
    return { detect, inspect, fill, waitForTargets, setTargets, pick, cancelPick, dispose };
  }
  // END_PAGE_FILL

  const pageFill = createPageFill({ excludeRoot:host, onStatus:notice => {
    if (!closed && notice?.message) setStatus(notice.message,notice.status === 'error' ? 'error' : 'info');
    if (!closed && notice?.status === 'selected') hubMotion.toast({id:'field-selection',title:'Campo selecionado',message:notice.message});
  } });

  function syncSummaries() {
    summaries.source.textContent = contextInput.value.trim() ? `${sourceKind} · ${contextInput.value.length.toLocaleString('pt-BR')} car.` : 'Adicionar texto';
    const level = levelOptions.find(([value]) => value === Number(levelInput.value)) || levelOptions[2];
    summaries.genre.textContent = `${level[0]} — ${level[1]}`;
    summaries.words.textContent = `${wordsInput.value} palavras`;
    summaries.writing.textContent = themeInput.value.trim() || (instructionsInput.value.trim() ? 'Personalizado' : 'Automático');
    const count = resultInput.value.match(/\S+/gu)?.length || 0;
    summaries.result.textContent = count ? `${count.toLocaleString('pt-BR')} palavras` : 'Aguardando';
    for (const summary of Object.values(summaries)) summary.title = summary.textContent;
    for (const button of shadow.querySelectorAll('[data-choice]')) {
      const selected = (button.dataset.choice === 'level' ? levelInput : wordsInput).value === button.dataset.value;
      button.setAttribute('aria-pressed',String(selected));
    }
  }

  function closePane(restoreFocus = true) {
    if (!activePane) return;
    const opener = paneOpener;
    activePane = null;
    paneOpener = null;
    hubMotion.exit(secondary);
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
    hubMotion.enter(secondary);
    hubMotion.enter(panes[name]);
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
    for (const control of [contextInput,themeInput,levelInput,wordsInput,instructionsInput,capturePage,captureSelection,generate,retryConnection,saveSource,saveWriting,inspectFields,...shadow.querySelectorAll('[data-choice]')]) {
      control.disabled = busy;
    }
    for (const control of [fillPage,pickTitle,pickEssay]) control.disabled = busy || !resultInput.value.trim();
    cancel.hidden = !busy && !pendingFill;
    generateText.textContent = busy ? 'Gerando…' : 'Gerar redação';
    hubMotion.busy(generate,busy);
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
      if (content.text) hubMotion.toast({id:'reference-read',title:'Página lida',message:'O texto de referência está pronto para revisão.',kind:content.truncated ? 'warning' : 'success'});
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
      level:Number(levelInput.value),words:Number(wordsInput.value),
      instructions:instructionsInput.value.trim()
    };
  }

  function httpError(response, payload) {
    const messages = {
      400:'A solicitação foi recusada. Confira as opções e o texto de referência.',
      401:'O servidor recusou a solicitação. Recarregue o script ou tente novamente mais tarde.',
      402:'O serviço precisa de saldo ou de uma alteração no plano.',
      403:'A API negou o acesso à solicitação. Tente novamente mais tarde.',
      404:'O serviço não foi encontrado. Reabra o favorito e tente novamente.',
      413:'O texto excedeu o limite do serviço. Reduza o texto de referência.',
      429:'Limite de uso atingido. Aguarde antes de tentar novamente.',
      503:'A geração ainda não foi configurada no servidor.',
      504:'O Redator Batata demorou para responder. Tente novamente em instantes.'
    };
    let message = messages[response.status] || (response.status >= 500 ? 'O Redator Batata está indisponível no momento. Tente novamente em instantes.' : 'Não foi possível concluir a solicitação ao Redator Batata.');
    const retry = response.headers.get('retry-after');
    if (response.status === 429 && retry && /^\d+(\.\d+)?$/.test(retry)) message += ` Aguarde cerca de ${Math.ceil(Number(retry))} segundos.`;
    if ([400,404,502,503].includes(response.status) && typeof payload?.error?.message === 'string') {
      const detail = payload.error.message.slice(0,350);
      message += ` Detalhe: ${detail}`;
    }
    return new Error(`${message} (HTTP ${response.status})`);
  }

  // A janela faz a chamada na origem do serviço quando a página bloqueia fetch.
  // Só abre por um clique explícito e nunca repete automaticamente um POST.
  function fetchInConnectionWindow(input, signal) {
    return new Promise((resolve,reject) => {
      if (!/^https?:$/.test(window.location.protocol) || !window.crypto?.getRandomValues) {
        reject(new Error('Esta página não permite a conexão auxiliar. Abra o hub pelo link abaixo e cole a referência.'));
        return;
      }
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      const channel = Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
      const url = new URL('/connection.html',SERVICE_ORIGIN);
      url.hash = new URLSearchParams({channel,origin:window.location.origin}).toString();
      let popup = null;
      let sent = false;
      let settled = false;
      let poll = null;
      let handshake = null;
      function finish(error,response,closePopup = true) {
        if (settled) return;
        settled = true;
        window.removeEventListener('message',receive);
        signal.removeEventListener('abort',abort);
        clearInterval(poll);
        clearTimeout(handshake);
        if (closePopup) {
          try { popup?.close(); } catch { /* A página pode separar os contextos. */ }
        }
        if (error) reject(error);
        else resolve(response);
      }
      function abort() {
        try { popup?.postMessage({type:'redator-batata:cancel',channel},SERVICE_ORIGIN); } catch { /* A janela já pode ter fechado. */ }
        finish(new Error('Solicitação interrompida.'));
      }
      function receive(event) {
        const message = event.data;
        if (event.source !== popup || event.origin !== SERVICE_ORIGIN || !message || message.channel !== channel) return;
        if (message.type === 'redator-batata:manual') {
          finish(new Error('Continue no hub da janela auxiliar e cole a referência por lá.'),null,false);
        } else if (message.type === 'redator-batata:ready' && !sent) {
          sent = true;
          clearTimeout(handshake);
          popup.postMessage({type:'redator-batata:generate',channel,input},SERVICE_ORIGIN);
        } else if (sent && message.type === 'redator-batata:response') {
          if (!Number.isInteger(message.status) || message.status < 200 || message.status > 599 || typeof message.body !== 'string' || message.body.length > 131072) {
            finish(new Error('A janela auxiliar devolveu uma resposta inválida.'));
            return;
          }
          const headers = new Headers();
          if (typeof message.retryAfter === 'string' && /^\d+(\.\d+)?$/.test(message.retryAfter)) headers.set('Retry-After',message.retryAfter);
          try { finish(null,new Response(message.body || null,{status:message.status,headers})); }
          catch { finish(new Error('A janela auxiliar devolveu uma resposta inválida.')); }
        } else if (sent && message.type === 'redator-batata:error') {
          finish(new Error(typeof message.message === 'string' ? message.message.slice(0,350) : 'Não foi possível conectar pela janela auxiliar.'));
        }
      }
      window.addEventListener('message',receive);
      signal.addEventListener('abort',abort,{once:true});
      try { popup = window.open(url.href,'_blank','popup=yes,width=400,height=360'); }
      catch { finish(new Error('Não foi possível abrir a janela auxiliar. Use o link abaixo para abrir o hub.')); return; }
      if (!popup) {
        finish(new Error('O navegador bloqueou a janela auxiliar. Permita pop-ups para esta página ou use o link abaixo.'));
        return;
      }
      if (signal.aborted) { abort(); return; }
      poll = window.setInterval(() => {
        if (popup.closed) finish(new Error('A janela auxiliar foi fechada ou isolada pelo navegador. Use o link abaixo e cole a referência.'));
      },500);
      handshake = window.setTimeout(() => finish(new Error('A página impediu a conexão com a janela auxiliar. Cole a referência na janela aberta ou use o link abaixo.'),null,false),12000);
    });
  }

  function observeConnectionPolicy(event) {
    if (event.disposition === 'enforce' && event.effectiveDirective === 'connect-src' &&
        (event.blockedURI === SERVICE_ORIGIN || event.blockedURI.startsWith(`${SERVICE_ORIGIN}/`))) {
      connectionBlockedByPolicy = true;
      // O navegador pode emitir este evento depois de rejeitar o fetch.
      if (!closed && !activeRequest && !useConnectionWindow && !retryConnection.hidden) {
        setStatus(BLOCKED_CONNECTION_MESSAGE,'error');
      }
    }
  }
  document.addEventListener('securitypolicyviolation',observeConnectionPolicy);

  function syncFieldSearch() {
    const searching = Boolean(pendingFill);
    host.dataset.fieldSearch = searching ? 'searching' : 'idle';
    fieldSearchStatus.hidden = !searching;
    stopFieldSearch.hidden = !searching;
    fieldSearchStatus.textContent = searching ? 'Procurando os campos de título e redação… Abra a área de escrita na página. O hub continua tentando até encontrar os dois campos.' : '';
    cancel.hidden = !activeRequest && !searching;
  }

  function renderFieldInspector() {
    if (closed) return;
    const inspection = pageFill.inspect();
    const targets = pageFill.detect();
    const reasons = {disabled:'Desativado pela página',readonly:'Somente leitura','aria-hidden':'Espelho oculto do editor','not-visible':'Oculto na página','inert-or-ancestor':'Indisponível no contêiner da página',unavailable:'Indisponível'};
    let summary = `${inspection.textareaCount} caixas de texto encontradas; ${inspection.editableTextareaCount} editáveis. Escolha qual recebe o título e qual recebe a redação.`;
    if (!inspection.textareaCount) {
      summary = location.origin === SERVICE_ORIGIN
        ? 'Este hub está aberto na janela do serviço. Para preencher a atividade, abra o favorito na própria aba da Sala do Futuro.'
        : 'Nenhuma caixa de texto foi encontrada nesta aba. Abra a área de escrita da atividade e clique novamente em Ver campos da página.';
    } else if (!inspection.editableTextareaCount) summary += ' As caixas abaixo estão ocultas ou bloqueadas pela página.';
    if (inspection.inaccessibleFrames) summary += ` ${inspection.inaccessibleFrames} quadro(s) de outra origem não podem ser acessados nesta aba.`;
    fieldInspectorSummary.textContent = summary;
    fieldInspectorList.replaceChildren();
    inspection.fields.forEach((field,index) => {
      const row = element('div',{className:'field-option'},[
        element('strong',{},`${index + 1}. ${field.label || 'Caixa de texto'}`),
        element('small',{},field.id ? `ID: ${field.id}` : 'Sem ID')
      ]);
      if (!field.editable) row.append(element('small',{},reasons[field.reason] || reasons.unavailable));
      else {
        const actions = element('div',{className:'row'});
        for (const kind of ['title','essay']) {
          const selected = targets[kind] === field.element;
          const other = targets[kind === 'title' ? 'essay' : 'title'];
          const button = element('button',{
            id:`select-${kind}-${index}`,type:'button','aria-pressed':String(selected),
            disabled:Boolean(activeRequest) || other === field.element
          },`${kind === 'title' ? 'Título' : 'Redação'}${selected ? ' selecionado' : ''}`);
          button.addEventListener('click',async () => {
            if (closed || activeRequest) return;
            try {
              const detection = pageFill.setTargets({[kind]:field.element});
              renderFieldInspector();
              setStatus('Campo vinculado. Ao identificar os dois campos, o hub aplica a redação já gerada.');
              hubMotion.toast({id:'field-selection',title:'Campo vinculado',message:kind === 'title' ? 'Campo do título selecionado.' : 'Campo da redação selecionado.'});
              if (detection.status === 'ready' && !pendingFill && resultInput.value.trim()) await fillPageFields();
            } catch (error) {
              renderFieldInspector();
              setStatus(error?.message || 'Este campo não está mais disponível. Atualize a lista.','warning');
            }
          });
          actions.append(button);
        }
        row.append(actions);
      }
      fieldInspectorList.append(row);
    });
    fieldInspector.hidden = false;
    inspectFields.setAttribute('aria-expanded','true');
  }

  function stopFieldSearchJob(announce = false) {
    const job = pendingFill;
    if (!job) return;
    pendingFill = null;
    if (announce) pageFill.cancelPick();
    job.controller.abort();
    searchNotice?.();
    searchNotice = null;
    syncFieldSearch();
    if (announce && !closed) {
      setStatus('Busca de campos cancelada. O título e a redação continuam no hub.');
      hubMotion.toast({id:'field-search-stopped',title:'Busca cancelada',message:'Seu título e sua redação foram preservados no hub.',kind:'info'});
    }
  }

  function startFieldSearch(initialOutcome) {
    stopFieldSearchJob();
    if (closed || !resultInput.value.trim()) return;
    const detected = pageFill.detect();
    const preserveTargets = {};
    if (initialOutcome?.filledTitle && detected.title) preserveTargets.title = detected.title;
    if (initialOutcome?.filledEssay && detected.essay) preserveTargets.essay = detected.essay;
    const job = {controller:new AbortController(),title:resultTitleInput.value,essay:resultInput.value,preserveTargets};
    pendingFill = job;
    syncFieldSearch();
    searchNotice = hubMotion.toast({id:'field-search',title:'Procurando os campos',message:'O hub continua tentando. Abra os campos na página ou use Escolher título e Escolher redação.',kind:'info'});
    setStatus('Redação pronta. Procurando os campos de título e redação até encontrar. Você pode abrir a área de escrita ou escolher os campos manualmente.');
    (async () => {
      try {
        while (!closed && pendingFill === job && !job.controller.signal.aborted) {
          const targets = await pageFill.waitForTargets({signal:job.controller.signal,onWaiting:detection => {
            if (closed || pendingFill !== job) return;
            fieldSearchStatus.textContent = `Procurando os campos… ${detection.candidates.title.length} candidato(s) a título e ${detection.candidates.essay.length} a redação. Use Ver campos da página para escolher diretamente.`;
          }});
          if (!targets || closed || pendingFill !== job || job.controller.signal.aborted) return;
          if (resultTitleInput.value !== job.title || resultInput.value !== job.essay) return;
          const outcome = await fillPageFields(job.controller.signal,false,job.preserveTargets);
          if (!outcome || ((job.preserveTargets.title || outcome.filledTitle) && (job.preserveTargets.essay || outcome.filledEssay)) || outcome.errors?.length ||
              !['not-found','ambiguous','partial'].includes(outcome.status)) return;
        }
      } catch (_) {
        if (!closed && pendingFill === job && !job.controller.signal.aborted) {
          setStatus('A busca foi interrompida. Seu texto está no hub; clique em Preencher página para procurar de novo.','warning');
        }
      } finally {
        if (pendingFill === job) stopFieldSearchJob();
      }
    })();
  }

  async function fillPageFields(signal, keepSearching = true, preserveTargets = {}) {
    const revision = fillRevision;
    const previous = fillTail;
    let release;
    fillTail = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      if (closed || signal?.aborted || revision !== fillRevision || !resultInput.value.trim()) return null;
      const outcome = await pageFill.fill({title:resultTitleInput.value.trim(),essay:resultInput.value,signal,preserveTargets});
      if (closed || signal?.aborted || revision !== fillRevision) return null;
      setStatus(`Redação pronta. ${outcome.message}`,['ready','filled'].includes(outcome.status) ? 'info' : 'warning');
      const complete = outcome.filledTitle && outcome.filledEssay;
      const partial = outcome.filledTitle || outcome.filledEssay;
      filledNotice = hubMotion.toast({id:'essay-filled',title:complete ? 'Redação preenchida' : partial ? 'Redação parcialmente preenchida' : 'Escolha os campos',message:outcome.message,kind:complete ? 'success' : 'warning'});
      if (keepSearching && !complete && !outcome.errors?.length && ['not-found','ambiguous','partial'].includes(outcome.status)) startFieldSearch(outcome);
      return outcome;
    } finally { release(); }
  }

  async function choosePageField(kind) {
    if (activeRequest || closed) return;
    closePane(false);
    const selected = await pageFill.pick(kind);
    if (closed) return;
    openPane('result');
    if (selected) setStatus(pendingFill ? 'Campo selecionado. A busca continua até encontrar os dois campos.' : 'Campo selecionado. Clique em Preencher página para aplicar o título e a redação.');
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
    closePane(false);
    pageFill.cancelPick?.();
    fillRevision += 1;
    stopFieldSearchJob();
    generatedNotice?.();
    filledNotice?.();
    generatedNotice = null;
    filledNotice = null;
    const request = { controller:new AbortController(), reason:null, timer:null };
    activeRequest = request;
    request.timer = window.setTimeout(() => {
      request.reason = 'timeout';
      request.controller.abort();
    },TIMEOUT_MS);
    setBusy(true);
    retryConnection.hidden = true;
    connectionHelp.hidden = true;
    connectionBlockedByPolicy = false;
    setStatus('Gerando a redação com o Redator Batata… Você pode cancelar a solicitação.');
    try {
      const input = createRequest();
      const response = useConnectionWindow ? await fetchInConnectionWindow(input,request.controller.signal) : await fetch(API_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        credentials:'omit',
        referrerPolicy:'no-referrer',
        signal:request.controller.signal,
        body:JSON.stringify(input)
      });
      let payload;
      try { payload = await response.json(); }
      catch {
        if (request.controller.signal.aborted) throw new Error('aborted');
        if (!response.ok) throw httpError(response,null);
        throw new Error('O Redator Batata devolveu uma resposta inválida. Tente novamente.');
      }
      if (!response.ok) throw httpError(response,payload);
      if (request.controller.signal.aborted || closed) return;
      const choice = payload?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('O serviço devolveu uma resposta vazia ou em formato inválido. Tente novamente.');
      }
      resultInput.value = content.trim();
      resultTitleInput.value = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim().slice(0,200) : input.theme || 'Reflexões sobre o tema';
      const count = resultInput.value.match(/\S+/gu)?.length || 0;
      shadow.getElementById('result-count').textContent = `${count.toLocaleString('pt-BR')} palavras`;
      copy.disabled = false;
      download.disabled = false;
      syncSummaries();
      if (choice.finish_reason === 'length') {
        setStatus('O limite de saída foi atingido e a redação pode estar incompleta. O trecho recebido está abaixo; tente uma extensão menor.','warning');
        hubMotion.toast({id:'generation-error',title:'Redação incompleta',message:'O texto ficou disponível no hub. Tente uma extensão menor.',kind:'warning'});
      } else if (choice.finish_reason && choice.finish_reason !== 'stop') {
        setStatus('A resposta terminou antes da conclusão normal. Revise o texto recebido e tente novamente se necessário.','warning');
        hubMotion.toast({id:'generation-error',title:'Resposta interrompida',message:'Revise o trecho recebido antes de usar.',kind:'warning'});
      } else {
        generatedNotice = hubMotion.toast({id:'essay-generated',title:'Redação realizada',message:'Título e texto gerados. Agora é hora de revisar.'});
        await fillPageFields(request.controller.signal);
        if (request.controller.signal.aborted) throw new Error('aborted');
        if (closed) return;
      }
      if (minimize.getAttribute('aria-expanded') === 'true') openPane('result');
    } catch (error) {
      if (closed) return;
      if (request.controller.signal.aborted) {
        setStatus(request.reason === 'timeout' ? 'O Redator Batata demorou mais de 90 segundos. A solicitação foi interrompida; tente novamente.' : 'Geração cancelada. Você pode tentar novamente.','warning');
        generatedNotice?.();
        hubMotion.toast({id:'generation-error',title:request.reason === 'timeout' ? 'Tempo de espera esgotado' : 'Geração cancelada',message:'Você pode tentar novamente quando quiser.',kind:'warning'});
      } else if (error instanceof TypeError) {
        retryConnection.hidden = false;
        connectionHelp.hidden = false;
        setStatus(connectionBlockedByPolicy ? BLOCKED_CONNECTION_MESSAGE : 'A conexão com a API falhou. Confira sua internet ou clique em Gerar em janela auxiliar para tentar por outra conexão.','error');
      } else {
        if (useConnectionWindow) {
          retryConnection.hidden = false;
          connectionHelp.hidden = false;
        }
        setStatus(error?.message || 'Ocorreu um erro inesperado ao gerar a redação.','error');
      }
      if (!request.controller.signal.aborted) hubMotion.toast({id:'generation-error',title:'Não foi possível gerar',message:status.textContent,kind:'error'});
    } finally {
      clearTimeout(request.timer);
      if (activeRequest === request) activeRequest = null;
      if (!closed) setBusy(false);
    }
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    stopFieldSearchJob();
    host.removeAttribute('id');
    host.style.setProperty('pointer-events','none','important');
    if (activeRequest) {
      clearTimeout(activeRequest.timer);
      activeRequest.controller.abort();
    }
    contextInput.value = '';
    resultInput.value = '';
    resultTitleInput.value = '';
    pageFill.dispose();
    savedSelection = '';
    document.removeEventListener('selectionchange',rememberSelection);
    document.removeEventListener('pointerdown',outsideClick);
    document.removeEventListener('keydown',outsideKeydown);
    document.removeEventListener('securitypolicyviolation',observeConnectionPolicy);
    window.removeEventListener('pagehide',cleanup);
    Promise.all([hubMotion.exit(main,{hide:false}),hubMotion.exit(secondary,{hide:false})]).finally(() => {
      hubMotion.dispose();
      host.remove();
    });
  }

  for (const [name,trigger] of Object.entries(triggers)) trigger.addEventListener('click',() => {
    if (activePane === name) closePane();
    else openPane(name);
  });
  secondaryClose.addEventListener('click',() => closePane());
  for (const button of shadow.querySelectorAll('[data-choice]')) button.addEventListener('click',() => {
    const kind = button.dataset.choice;
    const input = kind === 'level' ? levelInput : wordsInput;
    input.value = button.dataset.value;
    syncSummaries();
    const summary = summaries[kind === 'level' ? 'genre' : 'words'];
    announcement.textContent = `${kind === 'level' ? 'Tipo' : 'Extensão'}: ${summary.textContent}.`;
    hubMotion.pulse(summary);
    hubMotion.toast({id:'setting-choice',title:kind === 'level' ? 'Tipo selecionado' : 'Extensão selecionada',message:summary.textContent});
    closePane();
  });
  saveSource.addEventListener('click',() => {
    syncSummaries();
    announcement.textContent = 'Texto de referência selecionado.';
    setStatus('Texto de referência atualizado.');
    hubMotion.toast({id:'reference-read',title:'Referência atualizada',message:'O texto selecionado será usado na próxima geração.'});
    closePane();
  });
  saveWriting.addEventListener('click',() => {
    syncSummaries();
    announcement.textContent = 'Tema e instruções atualizados.';
    setStatus('Tema e instruções atualizados.');
    hubMotion.toast({id:'writing-saved',title:'Tema atualizado',message:'Suas instruções foram selecionadas.'});
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
      hubMotion.toast({id:'reference-read',title:'Trecho selecionado',message:'A seleção foi capturada como referência.'});
      closePane();
    }
    else setStatus('Selecione um texto fora do painel e clique em Ler seleção. Você também pode colar o texto manualmente.','warning');
  });
  contextInput.addEventListener('input',() => { sourceKind = 'Manual'; updateCounter(); });
  for (const input of [themeInput,instructionsInput]) input.addEventListener('input',() => {
    input.setCustomValidity('');
    syncSummaries();
  });
  generate.addEventListener('click',generateEssay);
  fillPage.addEventListener('click',async () => {
    if (activeRequest || closed) return;
    stopFieldSearchJob();
    await fillPageFields();
  });
  stopFieldSearch.addEventListener('click',() => stopFieldSearchJob(true));
  inspectFields.addEventListener('click',renderFieldInspector);
  pickTitle.addEventListener('click',() => choosePageField('title'));
  pickEssay.addEventListener('click',() => choosePageField('essay'));
  retryConnection.addEventListener('click',() => {
    useConnectionWindow = true;
    generateEssay();
  });
  cancel.addEventListener('click',() => {
    if (!activeRequest) { stopFieldSearchJob(true); return; }
    activeRequest.reason = 'user';
    activeRequest.controller.abort();
  });
  minimize.addEventListener('click',() => {
    closePane(false);
    const collapse = minimize.getAttribute('aria-expanded') === 'true';
    if (collapse) hubMotion.exit(body,{collapse:true});
    else hubMotion.enter(body,'body');
    minimize.textContent = collapse ? '+' : '−';
    minimize.title = collapse ? 'Expandir' : 'Recolher';
    minimize.setAttribute('aria-label',collapse ? 'Expandir hub' : 'Recolher hub');
    minimize.setAttribute('aria-expanded', String(!collapse));
  });
  host.addEventListener('redator-reopen',() => {
    hubMotion.enter(main);
    hubMotion.enter(body,'body');
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
      if (!closed) {
        setStatus('Redação copiada.');
        hubMotion.toast({id:'copy-result',title:'Redação copiada',message:'O texto está na área de transferência.'});
      }
    } catch {
      if (closed) return;
      resultInput.focus();
      resultInput.select();
      setStatus('O navegador bloqueou a cópia automática. O texto está selecionado: use Ctrl+C ou ⌘C.','warning');
      hubMotion.toast({id:'copy-result',title:'Cópia manual',message:'O texto está selecionado. Use Ctrl+C ou ⌘C.',kind:'warning'});
    }
  });
  download.addEventListener('click',() => {
    if (!resultInput.value) return;
    const url = URL.createObjectURL(new Blob([resultInput.value],{ type:'text/plain;charset=utf-8' }));
    const anchor = element('a',{ href:url, download:'redacao-batata.txt' });
    shadow.append(anchor);
    anchor.click();
    anchor.remove();
    hubMotion.toast({id:'download-result',title:'Arquivo preparado',message:'A redação em .txt está pronta para baixar.'});
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  });

  syncSummaries();
  if (savedSelection) {
    sourceKind = 'Seleção';
    applyContext(savedSelection,'Trecho selecionado capturado.');
  }
  else capturePageText();
})();
