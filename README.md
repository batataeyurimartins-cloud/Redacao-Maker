# Redator Groq · hub compacto por bookmarklet

Hub preto de 284 px para gerar redações a partir do texto de uma página. O painel principal fica no canto inferior direito; as opções abrem no canto oposto e fecham quando você escolhe. Em telas pequenas, o principal reaparece ao concluir a escolha.

Repositório: https://github.com/batataeyurimartins-cloud/Redacao-Maker

Publicação: https://redacao-maker.vercel.app · Script: https://redacao-maker.vercel.app/hub.js

A Groq está integrada por um backend na Vercel: o navegador envia a referência para `/api/generate`, e o servidor chama a Groq. A chave do provedor permanece no servidor.

## Como usar

1. Acesse https://redacao-maker.vercel.app e mostre a barra de favoritos do navegador (`Ctrl+Shift+B` no Chrome/Edge ou `⌘⇧B` no Mac).
2. Arraste o botão **★ Redator Groq** para a barra de favoritos. Abra a página cujo texto deseja usar e clique nesse favorito.
3. Em **Referência**, revise o texto capturado e clique em **Usar este texto**. Você pode editar manualmente, reler a página ou usar uma seleção.
4. Em **Tipo**, escolha o nível de escrita: **1 — Bem simples**, **2 — Fraco**, **3 — Médio** (padrão), **4 — Bom** ou **5 — Máximo**. Em **Extensão**, escolha o tamanho. O painel auxiliar fecha e atualiza o resumo no hub. Em **Tema**, defina instruções se quiser.
5. Clique em **Gerar redação**. O hub gera o título e o texto separadamente e preenche os campos correspondentes da página quando consegue identificá-los. Se os campos ainda não estiverem disponíveis, continua procurando enquanto o hub estiver aberto e preenche quando encontrar os dois. O resultado também abre no painel auxiliar para revisão, cópia e download.

O hub mostra notificações para as ações concluídas, como **Redação realizada**, **Redação preenchida** e **Redação copiada**. Se apenas um campo for preenchido, avisa **Redação parcialmente preenchida**; se não identificar os campos, oferece a escolha manual. Os avisos desaparecem automaticamente, pausam quando recebem foco ou o mouse e podem ser fechados pelo **×**. Abertura, fechamento, recolhimento, seleções e geração têm animações, respeitando a preferência de movimento reduzido do sistema. A escolha do modelo fica no servidor.

A busca acompanha o carregamento e as mudanças da página, inclusive quando os campos aparecem depois ou são habilitados mais tarde. Ela usa a redação já gerada, sem novas chamadas à Groq. Você pode continuar usando o hub e selecionar os campos manualmente durante a busca. **Parar busca**, **Cancelar** ou fechar o hub interrompem a espera; gerar outra redação substitui a busca anterior. Depois de preencher, o hub encerra a busca e respeita suas edições seguintes.

A detecção reconhece os rótulos **Titulo** e **Redação**, inclusive quando aparecem como texto ao redor do campo. Em qualquer domínio ou caminho, também reconhece um único par de caixas MUI multiline do mesmo editor: a primeira recebe o título e a segunda, a redação. Essa alternativa não depende dos IDs aleatórios, das classes `css-*`, dos atributos de rastreamento do formulário ou da altura dos campos. Rótulos explícitos têm prioridade. Se houver vários candidatos, use **Escolher título** e **Escolher redação**, clique em cada campo da página e depois em **Preencher página**. Campos ocultos, desativados, de pesquisa, de referência e do próprio hub ficam fora da detecção automática. O hub não clica em botões de salvar ou enviar. Uma geração cancelada, com erro ou incompleta mantém os campos da página como estavam. A versão carregada aparece no cabeçalho do hub.

Em **Ver campos da página**, o hub lista as caixas que encontrou, seus rótulos, IDs e motivos de indisponibilidade, sem exibir o conteúdo dos campos. Use os botões **Título** e **Redação** da lista para vincular os campos exatos; o texto já gerado é aplicado quando os dois estão definidos. A vinculação também pode ser feita antes de gerar. Se o hub estiver aberto na janela do serviço, a lista explica que o favorito deve ser executado na própria aba da atividade.

Na Sala do Futuro, o formulário contém um controle interno chamado `hidden`. Esse nome sobrescreve a propriedade JavaScript `form.hidden`, sem tornar o formulário oculto. A detecção e o diagnóstico verificam os atributos reais `hidden` e `inert`, preservando o bloqueio de campos efetivamente ocultos ou indisponíveis. Campos com rótulos explícitos também têm prioridade sobre referências mais fracas, como um cabeçalho “Título” em outra parte da página.

O hub é público, sem login, senha ou código de acesso. Você pode compartilhar o link de instalação e o script. A chave da Groq permanece no servidor e não é solicitada aos visitantes.

Para instalar manualmente, clique em **Copiar bookmarklet**, crie um favorito chamado **Redator Groq** e cole o código no campo **URL/Endereço** do favorito, incluindo o prefixo `javascript:`. O botão **Baixar favorito** oferece um arquivo HTML para importar pelo gerenciador de favoritos do navegador.

Algumas páginas bloqueiam o carregamento externo do bookmarklet; páginas internas do navegador e visualizadores de PDF também podem impedir sua execução. Em **Outras formas de abrir o hub**, você encontra **Copiar script completo** para colar o código no Console. Não desative a segurança do navegador.

Se o hub abrir, mas a página bloquear a conexão, clique em **Gerar em janela auxiliar** após a falha. Uma janela do serviço faz a chamada na própria origem e devolve a redação ao hub original. Ela fecha ao concluir ou cancelar. A tentativa ocorre somente com seu clique: uma chamada que falhou não é repetida automaticamente. O texto e as opções seguem por mensagens entre as duas janelas, com origem, janela e identificador conferidos; não são colocados na URL.

Se o navegador bloquear pop-ups ou isolar as janelas, use **Abrir hub em outra janela** e cole a referência manualmente. Essa alternativa também está disponível em https://redacao-maker.vercel.app/connection.html quando a página bloqueia o carregamento do bookmarklet inteiro.

**Escape**, o **×** das opções ou um clique fora fecham o painel auxiliar. **−** recolhe o hub; **+** expande. O **×** do hub encerra a sessão e limpa os campos. Reexecutar a mesma versão preserva o rascunho; uma versão nova encerra e substitui a anterior.

## Configuração na Vercel

Cadastre estas variáveis como segredos no projeto, em **Production**, antes da implantação:

| Variável | Valor |
| --- | --- |
| `GROQ_API_KEY` | Chave criada em https://console.groq.com/keys |
| `GROQ_MODEL` | Opcional: `openai/gpt-oss-20b` (padrão) ou `openai/gpt-oss-120b` |

Não coloque esses valores no código ou no GitHub. `.env.example` documenta apenas os nomes, sem credenciais. Mudanças nas variáveis de produção exigem uma nova implantação para afetar o código implantado.

O projeto usa Node.js 24, `npm run build` e o diretório estático `public`. Os endpoints ficam em `api/`. O build copia o script público para `redator-groq.js` e `hub.js`, gera `bookmarklet.txt` e `favorito-redator-groq.html` e configura a origem usando `VERCEL_PROJECT_PRODUCTION_URL`, ou `DEPLOYMENT_ORIGIN` quando definido explicitamente.

A proteção de login da Vercel não deve interceptar os endpoints usados pelo console: eles precisam responder ao navegador em qualquer origem. `/api/generate` aceita requisições públicas, sem cabeçalho de autorização. O servidor controla os modelos, o prompt, o tamanho do texto e os limites de geração.

## API

- `GET /api/health`: informa `publicAccess: true` e `configured: true/false`, sem revelar valores. Isso verifica a presença da chave; não confirma sua validade na Groq.
- `POST /api/generate`: recebe `{context, theme, level, words, instructions}` sem credenciais no navegador. `level` é um inteiro de 1 a 5, com padrão 3. Retorna `title` separado, `choices[0].message.content` com o corpo da redação e `finish_reason`.
- `OPTIONS /api/generate`: permite o preflight CORS, sem executar uma geração.

O CORS também permite os cabeçalhos de rastreamento `Request-Id`, `Request-Context`, `Traceparent`, `Tracestate` e `Baggage`. Algumas páginas, como a Sala do Futuro, acrescentam esses cabeçalhos automaticamente ao `fetch`. Eles não são usados como autenticação nem repassados à Groq.

O servidor limita a referência a 18.000 caracteres, monta o prompt com o nível escolhido e usa até 2.800 tokens de saída. A proposta orienta o gênero do texto; a extensão aproximada pode ser 250, 350, 500 ou 700 palavras. O servidor espera até 80 segundos pela Groq; o cliente espera até 90 segundos pelo servidor. Para compatibilidade com scripts anteriores, a API ainda aceita os campos opcionais `genre` (`dissertativa`, `enem` ou `expositiva`) e `model` (um dos dois modelos indicados).

Os modelos GPT-OSS são servidos pela própria Groq e usam a chave Groq configurada. A chamada usa raciocínio baixo e retorna somente a redação. Os modelos Llama anteriores foram desativados para contas gratuitas/developer em agosto de 2026.

Há um limite local de 5 solicitações válidas por IP e 30 no total por minuto em cada instância do servidor. Ao atingir o limite, a API responde HTTP 429 e informa o tempo de espera. Os contadores ficam na memória de cada instância: não são um limite distribuído nem uma garantia de orçamento global.

## Captura e privacidade

A captura é local e prefere `main`, depois `article`, e por último o corpo da página. Exclui navegação, cabeçalhos, rodapés, conteúdo oculto, formulários e campos editáveis. Não lê imagens, PDFs, canvas ou documentos de iframes. Revise o texto, porque a organização varia entre páginas.

Só ao gerar, a referência revisada, tema, instruções, nível de escrita e extensão seguem para seu backend, que monta a solicitação para a Groq. O script não lê cookies nem inclui a URL ou o título da página na mensagem. Após uma geração completa, o título e o corpo são preenchidos nos campos identificados da página, com eventos de edição para que o site reconheça o texto. O envio da atividade depende da sua ação no site.

A chave Groq fica apenas no servidor. O hub mantém seus textos na memória, sem `localStorage`, `sessionStorage` ou cookies. Ao receber os campos preenchidos, o próprio site pode salvar o rascunho pelo seu funcionamento normal. Scripts e extensões da página podem observar o conteúdo: use páginas confiáveis. Shadow DOM isola a aparência.

A resposta é exibida como texto simples; HTML retornado pelo modelo não é executado. O prompt instrui o modelo a tratar comandos da referência como dados e evitar fontes inventadas. Revise a redação: modelos podem errar, e o formato ENEM não garante nota.

Cada geração pública consome a cota ou saldo da conta Groq configurada pelo administrador. Não há repetição automática. Cancelar interrompe a espera; a Groq pode já ter processado a chamada. Uma tentativa que falha preserva o resultado anterior.

## Falhas comuns

| Situação | Ação |
| --- | --- |
| HTTP 400 | Confira o nível de escrita, a extensão e o texto de referência. |
| HTTP 429 | Aguarde o prazo informado pela Groq. |
| HTTP 502 com erro de autenticação do provedor | Confira `GROQ_API_KEY` na Vercel e reimplante. |
| HTTP 503 | O administrador precisa configurar `GROQ_API_KEY` e reimplantar. |
| HTTP 504 | A Groq demorou a responder; tente novamente depois. |
| Conexão externa bloqueada por CSP ou falha de rede/CORS | Confira a conexão e use **Gerar em janela auxiliar**. Se o hub não carregar, abra `/connection.html` e cole a referência manualmente. |

## Desenvolvimento e verificação

```sh
npm install
npx playwright install chromium
npm run check
npm test
npm run build
```

A suíte contém testes de navegador e backend com credenciais fictícias e respostas simuladas. Ela verifica o hub, a captura, envio, autenticação, erros, limites, cancelamento, privacidade e download. Para usar Chromium do sistema, defina `CHROMIUM_PATH`.

Uma geração real na implantação ainda precisa de uma chave Groq configurada e válida no servidor. O estado de saúde, os testes simulados e a publicação dos arquivos não substituem essa verificação.
