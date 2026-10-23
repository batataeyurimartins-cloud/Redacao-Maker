(() => {
  'use strict';

  const status = document.getElementById('connection-status');
  const manualOpen = document.getElementById('manual-open');
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const channel = parameters.get('channel') || '';
  const requestedOrigin = parameters.get('origin') || '';
  const peer = window.opener;
  const REQUEST_TIMEOUT_MS = 85000;
  const READY_TIMEOUT_MS = 10000;
  let parentOrigin = '';
  let readyInterval = null;
  let readyTimeout = null;
  let requestTimeout = null;
  let controller = null;
  let started = false;
  let finished = false;
  let cancelled = false;
  let disposed = false;

  function setStatus(message, kind = 'info') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function stopReady() {
    clearInterval(readyInterval);
    clearTimeout(readyTimeout);
    readyInterval = null;
    readyTimeout = null;
  }

  function send(type, values = {}) {
    if (disposed || !parentOrigin || !peer) return false;
    try {
      if (peer.closed) return false;
      peer.postMessage({ type, channel, ...values }, parentOrigin);
      return true;
    } catch {
      return false;
    }
  }

  function stopRelay() {
    finished = true;
    stopReady();
    clearTimeout(requestTimeout);
    window.removeEventListener('message', receive);
    controller?.abort();
  }

  async function generate(input) {
    if (started || finished || disposed) return;
    started = true;
    stopReady();
    manualOpen.disabled = true;
    controller = new AbortController();
    let timedOut = false;
    requestTimeout = window.setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, REQUEST_TIMEOUT_MS);
    setStatus('Gerando a redação… Mantenha esta janela aberta.');
    try {
      const response = await fetch('/api/generate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        credentials:'omit',
        referrerPolicy:'no-referrer',
        signal:controller.signal,
        body:JSON.stringify(input)
      });
      const body = await response.text();
      if (cancelled || disposed) return;
      finished = true;
      const delivered = send('redator-batata:response', {
        status:response.status,
        body,
        retryAfter:response.headers.get('retry-after') || ''
      });
      if (delivered) setStatus('Resultado enviado ao hub. Você pode voltar à página anterior.');
      else setStatus('A conexão com a página anterior foi encerrada. Abra o hub nesta janela para continuar.', 'error');
    } catch {
      if (cancelled || disposed) return;
      finished = true;
      const message = timedOut
        ? 'O servidor demorou para responder. A solicitação foi interrompida; tente novamente no hub.'
        : 'Não foi possível conectar ao servidor. Confira sua internet e tente novamente no hub.';
      setStatus(message, 'error');
      send('redator-batata:error', { message });
    } finally {
      clearTimeout(requestTimeout);
      controller = null;
      if (!disposed) manualOpen.disabled = false;
    }
  }

  function receive(event) {
    if (disposed || finished || event.source !== peer || event.origin !== parentOrigin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== channel) return;
    if (data.type === 'redator-batata:cancel') {
      cancelled = true;
      stopRelay();
      manualOpen.disabled = false;
      setStatus('Geração cancelada. Volte ao hub para tentar novamente.');
      return;
    }
    if (data.type !== 'redator-batata:generate' || started) return;
    if (!data.input || typeof data.input !== 'object' || Array.isArray(data.input)) return;
    generate(data.input);
  }

  manualOpen.addEventListener('click', () => {
    if (manualOpen.disabled) return;
    send('redator-batata:manual');
    cancelled = true;
    stopRelay();
    manualOpen.disabled = true;
    setStatus('Abrindo o hub… Cole seu texto no campo de referência antes de gerar.');
    const hadHub = Boolean(document.getElementById('redator-batata-console'));
    const script = document.createElement('script');
    script.src = '/hub.js';
    script.onload = () => {
      script.remove();
      manualOpen.disabled = false;
      if (!hadHub) {
        const shadow = document.getElementById('redator-batata-console')?.shadowRoot;
        const input = shadow?.getElementById('context');
        if (input) {
          input.value = '';
          input.dispatchEvent(new Event('input',{bubbles:true}));
          shadow.getElementById('open-source')?.click();
        }
      }
      setStatus('Hub aberto. Cole seu texto de referência e revise antes de gerar.');
    };
    script.onerror = () => {
      script.remove();
      manualOpen.disabled = false;
      setStatus('Não foi possível abrir o hub. Recarregue esta página e tente novamente.', 'error');
    };
    document.head.append(script);
  });

  window.addEventListener('pagehide', () => {
    disposed = true;
    cancelled = true;
    stopRelay();
  }, { once:true });

  try {
    const parsedOrigin = new URL(requestedOrigin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== requestedOrigin) throw new Error('invalid origin');
    parentOrigin = parsedOrigin.origin;
  } catch {
    parentOrigin = '';
  }

  if (!parentOrigin || !peer || !/^[A-Za-z0-9_-]{22,128}$/.test(channel)) {
    finished = true;
    setStatus('Abra o hub nesta janela e cole seu texto de referência para gerar a redação.');
    return;
  }

  window.addEventListener('message', receive);
  function announceReady() {
    if (!send('redator-batata:ready')) {
      stopRelay();
      setStatus('A conexão com a página anterior não está disponível. Abra o hub nesta janela e cole seu texto de referência.');
    }
  }
  readyInterval = window.setInterval(announceReady, 250);
  readyTimeout = window.setTimeout(() => {
    stopRelay();
    setStatus('A conexão com a página anterior não foi concluída. Abra o hub nesta janela e cole seu texto de referência.');
  }, READY_TIMEOUT_MS);
  announceReady();
})();
